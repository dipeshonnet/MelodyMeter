import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index';
import { TestDB } from './database';
import { starterSongs } from '../data/starter';
import { insertSong, ratingResponse, upsertVote } from '../worker/src/store';
import { confirmVote, getPending, submitVote } from '../worker/src/voting';
import { hash, identityKey, now, normalizeEmail, sessionCookie, ApiError } from '../worker/src/security';
import { reserveAI, reserveEmail, nextDay, nextMonth } from '../worker/src/budgets';
import { cleanup, MODEL, processOneJob, parseAIResult, aiReservation, buildPrompt, previewAssessment } from '../worker/src/ai';
import { overallScore, primaryScore, FACTOR_IDS, voteSchema } from '../shared/rating';
import type { Env } from '../worker/src/types';

async function setup(extra: Partial<Env> = {}) {
  const db = new TestDB();
  const env: Env = { DB: db as unknown as D1Database, APP_ORIGIN: 'http://127.0.0.1:4321', DEV_MODE: 'true', EMAIL_HMAC_SECRET: 'test-only-secret-at-least-thirty-two-characters', ...extra };
  for (const song of starterSongs.slice(0, 2)) {
    await insertSong(env, song).run();
    await env.DB.prepare('INSERT INTO ai_ratings VALUES(?,?,?,?,?)').bind(song.id, JSON.stringify(song.ai), song.ai!.model, song.ai!.rubricVersion, now()).run();
  }
  return { env, db, songId: starterSongs[0].id, otherId: starterSongs[1].id };
}
const req = (path = '/api/audience', cookie = '', body?: unknown) => new Request(`http://127.0.0.1:8787${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { Origin: 'http://127.0.0.1:4321', 'Content-Type': 'application/json', Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
async function pending(env: Env, songId: string, overall = 7, email = 'person@example.org', factors = {}) {
  const result = await submitVote(req(), env, { songId, email, rating: { overall, factors } });
  assert.equal(result.status, 'verification_required');
  const row = await env.DB.prepare('SELECT verification_url FROM dev_mail ORDER BY rowid DESC LIMIT 1').first<{ verification_url: string }>();
  return new URLSearchParams(new URL(row!.verification_url).hash.slice(1)).get('token')!;
}

test('weights sum to 100, integers validate, overall is computed in code', () => {
  assert.equal(overallScore(Object.fromEntries(FACTOR_IDS.map(id => [id, 7])) as any), 7);
  assert.equal(starterSongs[0].ai!.overall, 3);
  assert.equal(voteSchema.safeParse({ overall: 7.2, factors: {} }).success, false);
  assert.equal(voteSchema.safeParse({ overall: 7, factors: { unknown: 3 } }).success, false);
});
test('ninth vote is AI primary; tenth qualifies only the overall and independently populated factors', async () => {
  const { env, songId } = await setup();
  for (let i = 0; i < 9; i++) await upsertVote(env, songId, `verified-${i}`, { overall: i % 2 ? 8 : 7, factors: i < 3 ? { range: 6 } : {} }).run();
  let result = await ratingResponse(env, songId);
  assert.equal(result.audience.overall.count, 9); assert.equal(result.audience.overall.qualified, false);
  assert.equal(primaryScore(result.ai, result.audience).source, 'ai');
  await upsertVote(env, songId, 'verified-9', { overall: 8, factors: {} }).run();
  result = await ratingResponse(env, songId);
  assert.deepEqual(result.audience.overall, { count: 10, score: 7.5, qualified: true });
  assert.equal(result.audience.factors.range.count, 3); assert.equal(result.audience.factors.range.score, null);
  assert.equal(primaryScore(result.ai, result.audience).source, 'community');
  assert.equal(result.ai!.overall, 3);
  for (let i = 0; i < 10; i++) await upsertVote(env, songId, `verified-${i}`, { overall: 2, factors: { rhythm: 9 } }).run();
  result = await ratingResponse(env, songId);
  assert.equal(result.audience.overall.score, 2); assert.equal(result.audience.factors.rhythm.score, 9);
  assert.equal(result.audience.factors.range.count, 0); // Clearing replaces previous selections.
});
test('preview and GET do not commit; confirmation is single use even under concurrent requests', async () => {
  const { env, songId } = await setup(); const token = await pending(env, songId, 8);
  assert.equal((await getPending(env, token)).rating.overall, 8);
  assert.equal((await worker.fetch(req(`/api/verifications/confirm?token=${token}`), env)).status, 404);
  assert.equal((await ratingResponse(env, songId)).audience.overall.count, 0);
  const outcomes = await Promise.allSettled([confirmVote(env, token), confirmVote(env, token)]);
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal((await ratingResponse(env, songId)).audience.overall.count, 1);
  const first = outcomes.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<any>;
  assert.match(first.value.cookie, /HttpOnly; SameSite=Lax/); assert.match(first.value.cookie, /Max-Age=2592000/);
  await assert.rejects(confirmVote(env, token), (e: ApiError) => e.status === 410);
  await assert.rejects(getPending(env, token), (e: ApiError) => e.code === 'used_token');
});
test('local test inbox retrieves the newest token without exposing recipient email', async () => {
  const { env, songId } = await setup(); await pending(env, songId);
  const response = await worker.fetch(req('/api/dev/mail'), env); assert.equal(response.status, 200);
  const value = await response.json() as { messages: any[] };
  assert.equal(value.messages.length, 1); assert.equal(value.messages[0].title, 'Bohemian Rhapsody');
  assert.equal(JSON.stringify(value).includes('person@example.org'), false);
});
test('case-insensitive emails replace votes; unverified changes cannot alter a counted vote', async () => {
  const { env, songId, otherId } = await setup();
  assert.equal(normalizeEmail('  PERSON@Example.org '), 'person@example.org');
  let token = await pending(env, songId, 8, ' PERSON@Example.org ', { range: 4 });
  const first = await confirmVote(env, token);
  // Verified session edits need no email, and may rate another recording.
  const cookie = first.cookie.split(';')[0];
  await submitVote(req('/api/audience', cookie), env, { songId, rating: { overall: 6, factors: {} } });
  assert.equal((await ratingResponse(env, songId)).audience.overall.count, 1);
  assert.equal((await ratingResponse(env, songId)).audience.factors.range.count, 0);
  await submitVote(req('/api/audience', cookie), env, { songId: otherId, rating: { overall: 9, factors: {} } });
  assert.equal((await ratingResponse(env, otherId)).audience.overall.count, 1);
  // Advance only send reservation timestamps so this test exercises replacement without sleeping.
  await env.DB.prepare("UPDATE budget_reservations SET created_at=created_at-61 WHERE kind='email'").run();
  token = await pending(env, songId, 2, 'person@example.ORG', { pace: 3 });
  const before = await env.DB.prepare('SELECT overall FROM votes WHERE song_id=?').bind(songId).first<{ overall: number }>();
  assert.equal(before!.overall, 6);
  await confirmVote(env, token);
  const after = await env.DB.prepare('SELECT overall,pace,range FROM votes WHERE song_id=?').bind(songId).first<any>();
  assert.deepEqual({ ...after }, { overall: 2, pace: 3, range: null });
  assert.equal((await ratingResponse(env, songId)).audience.overall.count, 1);
});
test('expired, forged and malformed tokens never count; cleanup removes expired private records', async () => {
  const { env, songId } = await setup(); const token = await pending(env, songId);
  await env.DB.prepare('UPDATE pending_verifications SET expires_at=?').bind(now() - 1).run();
  await assert.rejects(confirmVote(env, token)); await assert.rejects(confirmVote(env, 'a'.repeat(64))); await assert.rejects(confirmVote(env, 'bad'));
  assert.equal((await ratingResponse(env, songId)).audience.overall.count, 0);
  await cleanup(env); assert.equal(await env.DB.prepare('SELECT * FROM pending_verifications').first(), null);
});
test('only hashes and keyed identifiers are stored; production sessions require Secure', async () => {
  const { env, db, songId } = await setup(); const token = await pending(env, songId);
  const row = await env.DB.prepare('SELECT * FROM pending_verifications').first<any>();
  assert.equal(row.token_hash, await hash(token)); assert.notEqual(row.token_hash, token);
  assert.equal(row.email_key, await identityKey('person@example.org', env.EMAIL_HMAC_SECRET));
  assert.equal(JSON.stringify(db.sql.prepare('SELECT * FROM pending_verifications').all()).includes('person@example.org'), false);
  assert.match(sessionCookie(token, { ...env, APP_ORIGIN: 'https://melody.everydayai.work' }), /; Secure$/);
});
test('invalidating and deleting votes refreshes averages and removes qualification', async () => {
  const { env, songId } = await setup();
  for (let i = 0; i < 11; i++) await upsertVote(env, songId, `key${i}`, { overall: i === 10 ? 1 : 8, factors: { pace: 5 } }).run();
  await env.DB.prepare('UPDATE votes SET active=0 WHERE song_id=? AND email_key=?').bind(songId, 'key10').run();
  assert.equal((await ratingResponse(env, songId)).audience.overall.score, 8);
  await env.DB.prepare('DELETE FROM votes WHERE song_id=? AND email_key=?').bind(songId, 'key9').run();
  const result = await ratingResponse(env, songId); assert.equal(result.audience.overall.count, 9);
  assert.equal(result.audience.factors.pace.qualified, false); assert.equal(primaryScore(result.ai, result.audience).source, 'ai');
});
test('email reserves enforce 60 seconds, three per hour, daily and monthly caps atomically', async () => {
  const { env } = await setup();
  await reserveEmail(env, 'one', req()); await assert.rejects(reserveEmail(env, 'one', req()), (e: ApiError) => e.code === 'email_rate_limit');
  for (let i = 0; i < 2; i++) { await env.DB.prepare("UPDATE budget_reservations SET created_at=created_at-61 WHERE kind='email'").run(); await reserveEmail(env, 'one', req()); }
  await env.DB.prepare("UPDATE budget_reservations SET created_at=created_at-61 WHERE kind='email'").run();
  await assert.rejects(reserveEmail(env, 'one', req()), (e: ApiError) => e.code === 'email_rate_limit');
  const daily = { ...env, EMAIL_DAILY_LIMIT: '4' }; await reserveEmail(daily, 'two', req());
  await assert.rejects(reserveEmail(daily, 'three', req()), (e: ApiError) => e.code === 'email_daily_limit' && Date.parse(e.retryAt!) === nextDay() * 1000);
  const monthly = { ...env, EMAIL_MONTHLY_LIMIT: '4' };
  await assert.rejects(reserveEmail(monthly, 'four', req()), (e: ApiError) => e.code === 'email_monthly_limit' && Date.parse(e.retryAt!) === nextMonth() * 1000);
  // Verified sessions still work after mail quota is exhausted.
  const second = await setup({ EMAIL_DAILY_LIMIT: '1' });
  const token = await pending(second.env, second.songId); const { cookie } = await confirmVote(second.env, token);
  const vote = await submitVote(req('/api/audience', cookie.split(';')[0]), second.env, { songId: second.otherId, rating: { overall: 9, factors: {} } });
  assert.equal(vote.status, 'counted');
});
test('AI capacity reserves worst-case usage, including retries, without exceeding 80 percent', async () => {
  const { env } = await setup({ AI_DAILY_BUDGET: '999999' });
  assert.equal(await reserveAI(env, 7900), true);
  const values = await Promise.all([reserveAI(env, 100), reserveAI(env, 100)]);
  assert.equal(values.filter(Boolean).length, 1); assert.equal(await reserveAI(env, 1), false);
  assert.ok(aiReservation(buildPrompt(starterSongs[0])) > 40);
});
test('generation requests deduplicate; no-information and quota waiting are explicit', async () => {
  const { env, songId } = await setup(); await env.DB.prepare('DELETE FROM ai_ratings WHERE song_id=?').bind(songId).run();
  const input = { songId, turnstileToken: 'local-test' };
  const results = await Promise.all([worker.fetch(req('/api/ratings', '', input), env), worker.fetch(req('/api/ratings', '', input), env)]);
  assert.ok(results.every(r => r.status === 202));
  assert.equal((await env.DB.prepare('SELECT COUNT(*) AS n FROM generation_jobs').first<any>())!.n, 1);
  let calls = 0;
  const hosted: Env = { ...env, DEV_MODE: undefined, AI_MODEL: MODEL, AI_DAILY_BUDGET: '1', AI: { run: async () => { calls++; return { status: 'insufficient_information', explanation: 'I cannot assess this specific recording reliably.' }; } } };
  await processOneJob(hosted); assert.equal(calls, 0);
  assert.equal((await ratingResponse(env, songId)).job!.retryAt, new Date(nextDay() * 1000).toISOString());
  await env.DB.prepare('UPDATE generation_jobs SET next_attempt_at=0').run();
  await processOneJob({ ...hosted, AI_DAILY_BUDGET: '8000' });
  assert.equal(calls, 1); assert.equal((await ratingResponse(env, songId)).job!.status, 'insufficient_information');
  assert.equal((await ratingResponse(env, songId)).ai, null);
});
test('valid AI output is saved once and weighted; fabricated measurements and source references are rejected', async () => {
  const { env, songId } = await setup(); const { overall, model, generatedAt, rubricVersion, ...output } = starterSongs[0].ai!;
  assert.throws(() => parseAIResult({ ...output, explanation: 'The melody measures exactly 120 BPM and spans E4 to G5.' }));
  assert.throws(() => parseAIResult({ ...output, sourceIds: ['invented-source'] }));
  assert.throws(() => parseAIResult({ ...output, factors: { ...output.factors, range: 9 }, reasons: { ...output.reasons, range: 'The wide pitch range is demanding and challenging.' } }));
  assert.doesNotThrow(() => parseAIResult({ ...output, factors: { ...output.factors, range: 9 }, reasons: { ...output.reasons, range: 'The narrow range is comfortable and not demanding.' } }));
  await env.DB.prepare('DELETE FROM ai_ratings WHERE song_id=?').bind(songId).run();
  await env.DB.prepare('INSERT INTO generation_jobs(song_id,created_at,updated_at) VALUES(?,?,?)').bind(songId, now(), now()).run();
  let calls = 0; const hosted = { ...env, DEV_MODE: undefined, AI: { run: async () => { calls++; return { response: JSON.stringify(output) }; } } };
  await Promise.all([processOneJob(hosted), processOneJob(hosted)]);
  assert.equal(calls, 1); const result = await ratingResponse(env, songId); assert.equal(result.ai!.overall, overallScore(output.factors)); assert.equal(result.ai!.model, MODEL);
  await processOneJob(hosted); assert.equal(calls, 1);
});
test('qualitative difficulty maps to ease in the correct direction and rejects incomplete profiles', () => {
  const { overall, model, generatedAt, rubricVersion, factors, ...output } = starterSongs[0].ai!;
  const reasons = Object.fromEntries(FACTOR_IDS.map(id => [id, 'A predictable, comfortable repeated lead phrase.']));
  const levels = Object.fromEntries(FACTOR_IDS.map(id => [id, 'easy']));
  const easy = parseAIResult({ ...output, reasons, levels });
  assert.equal(easy.status, 'rated');
  if (easy.status === 'rated') assert.equal(overallScore(easy.factors), 8);
  const hard = parseAIResult({ ...output, levels: Object.fromEntries(FACTOR_IDS.map(id => [id, 'very_hard'])) });
  if (hard.status === 'rated') assert.equal(overallScore(hard.factors), 2);
  assert.throws(() => parseAIResult({ ...output, reasons, levels: { ...levels, range: 'unknown' } }));
  assert.throws(() => parseAIResult({ ...output, reasons, levels: { pace: 'easy' } }));
  assert.throws(() => parseAIResult({ ...output, reasons, levels, factors }));
});

test('explicit recalibration archives AI and preserves audience votes; invalid output keeps the old score', async () => {
  const { env, songId } = await setup();
  await upsertVote(env, songId, 'verified-singer', { overall: 9, factors: { range: 8 } }).run();
  const original = (await ratingResponse(env, songId)).ai;
  const hosted = { ...env, DEV_MODE: undefined, ADMIN_SECRET: 'test-admin', AI: { run: async () => ({ response: '{}' }) } };
  const request = () => new Request('https://melody.everydayai.work/api/admin/recalibrate', { method: 'POST', headers: { Authorization: 'Bearer test-admin', 'Content-Type': 'application/json' }, body: JSON.stringify({ songId }) });
  assert.equal((await worker.fetch(request(), hosted)).status, 200);
  await processOneJob(hosted);
  assert.deepEqual((await ratingResponse(env, songId)).ai, original);
  const { overall, model, generatedAt, rubricVersion, ...output } = starterSongs[1].ai!;
  await env.DB.prepare('UPDATE generation_jobs SET next_attempt_at=0').run();
  await processOneJob({ ...hosted, AI: { run: async () => ({ response: JSON.stringify(output) }) } });
  const refreshed = await ratingResponse(env, songId);
  assert.equal(refreshed.ai!.overall, overall);
  assert.equal(refreshed.audience.overall.count, 1);
  assert.equal(refreshed.audience.factors.range.count, 1);
  const archived = await env.DB.prepare('SELECT payload FROM ai_assessment_history WHERE song_id=?').bind(songId).first<any>();
  assert.deepEqual(JSON.parse(archived.payload), original);
  assert.equal((await env.DB.prepare('SELECT overall,range FROM votes WHERE song_id=?').bind(songId).first<any>())!.overall, 9);
});

test('assessment previews consume the same AI budget and never replace a saved rating', async () => {
  const { env, songId } = await setup();
  const before = (await ratingResponse(env, songId)).ai;
  let calls = 0;
  const hosted = { ...env, DEV_MODE: undefined, AI_MODEL: MODEL, AI_DAILY_BUDGET: '1', AI: { run: async () => { calls++; return { status: 'insufficient_information', explanation: 'This recording is unfamiliar.' }; } } };
  await assert.rejects(previewAssessment(hosted, songId), (e: any) => e.code === 'ai_daily_limit');
  assert.equal(calls, 0);
  assert.equal((await previewAssessment({ ...hosted, AI_DAILY_BUDGET: '8000' }, songId)).status, 'insufficient_information');
  assert.equal(calls, 1);
  assert.deepEqual((await ratingResponse(env, songId)).ai, before);
});

test('origin, validation, Turnstile and private local routes are enforced server-side', async () => {
  const { env, songId } = await setup();
  let response = await worker.fetch(new Request('http://127.0.0.1:8787/api/audience', { method: 'POST', headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' }, body: '{}' }), env); assert.equal(response.status, 403);
  response = await worker.fetch(req('/api/audience', '', { songId, email: 'a@example.org', rating: { overall: 99, factors: {} } }), env); assert.equal(response.status, 400);
  const production = { ...env, APP_ORIGIN: 'https://melody.everydayai.work' };
  response = await worker.fetch(new Request('https://melody.everydayai.work/api/dev/mail'), production); assert.equal(response.status, 404);
  response = await worker.fetch(new Request('https://melody.everydayai.work/api/audience', { method: 'POST', headers: { Origin: production.APP_ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ songId, rating: { overall: 7, factors: {} }, email: 'a@example.org', turnstileToken: 'local-test' }) }), production); assert.equal(response.status, 503);
});
