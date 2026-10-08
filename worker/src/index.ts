import { z } from 'zod';
import { audienceFromPayload, overallScore, RUBRIC_VERSION, aiOutputSchema, type Song } from '../../shared/rating';
import { ApiError, body, checkOrigin, hash, localDev, now, sessionEmail, turnstile } from './security';
import { getSong, insertSong, ratingResponse, songFromRow } from './store';
import { confirmVote, currentVote, getPending, submitVote } from './voting';
import { cleanup, processOneJob, previewAssessment } from './ai';
import { externalSearch, resolveRecording } from './musicbrainz';
import { reserveAction } from './budgets';
import type { Env, SongRow } from './types';
import { googleConfigured, startGoogle, finishGoogle } from './google';
import { listSavedSongs, changeSavedSongs } from './saved-songs';

function json(value: unknown, status = 200, headers: Record<string, string> = {}) {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', ...headers } });
}
async function admin(request: Request, env: Env) {
  if (localDev(env) && ['127.0.0.1', 'localhost'].includes(new URL(request.url).hostname)) {
    // Loopback is reachable by other websites. The development auth bypass must
    // still enforce browser origin and JSON checks before executing commands.
    if (request.method === 'POST') checkOrigin(request, env);
    return;
  }
  const value = request.headers.get('Authorization');
  if (!env.ADMIN_SECRET || !value || (await hash(value)) !== (await hash(`Bearer ${env.ADMIN_SECRET}`))) throw new ApiError(403, 'Administrator access is required.');
}

export async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '');
  if (request.method === 'POST' && !path.startsWith('/api/admin/')) checkOrigin(request, env);
  if (path === '/api/health' && request.method === 'GET') return json({ ok: true, local: localDev(env), verificationConfigured: localDev(env) || !!(env.RESEND_API_KEY && env.EMAIL_HMAC_SECRET && env.TURNSTILE_SECRET_KEY), aiConfigured: !localDev(env) && !!env.AI, model: env.AI_MODEL });
  if (path === '/api/session' && request.method === 'GET') return json({ verified: !!(await sessionEmail(request, env)) });
  if (path === '/api/saved-songs' && request.method === 'GET') return json(await listSavedSongs(request, env));
  if (path === '/api/saved-songs' && request.method === 'POST') return json(await changeSavedSongs(request, env, await body(request)));
  if (path === '/api/auth/google/config' && request.method === 'GET') return json({ enabled: googleConfigured(env) });
  if (path === '/api/auth/google/start' && request.method === 'POST') {
    const result = await startGoogle(request, env);
    return json({ clientId: result.clientId, nonce: result.nonce }, 200, { 'Set-Cookie': result.cookie });
  }
  if (path === '/api/auth/google' && request.method === 'POST') {
    const cookie = await finishGoogle(request, env, await body(request));
    return json({ verified: true }, 200, { 'Set-Cookie': cookie });
  }
  if (path === '/api/search' && request.method === 'GET') {
    const query = (url.searchParams.get('q') || '').trim();
    if (query.length > 160) throw new ApiError(400, 'Search with fewer than 160 characters.');
    if (url.searchParams.get('external') === '1') return json({ songs: await externalSearch(env, query), external: true });
    const terms = query.toLowerCase().normalize('NFKD').split(/\s+/).filter(Boolean);
    const filter = terms.map(() => "search_text LIKE ? ESCAPE '\\'").join(' AND ');
    const search = env.DB.prepare(`SELECT songs.*,ai_ratings.payload AS ai_payload FROM songs LEFT JOIN ai_ratings ON songs.id=ai_ratings.song_id${filter ? ' WHERE ' + filter : ''} ORDER BY title LIMIT 100`).bind(...terms.map(term => `%${term.replace(/[\\%_]/g, '\\$&')}%`));
    const rows = await search.all<SongRow & { ai_payload: string | null }>();
    return json({ songs: rows.results.map(row => ({ ...songFromRow(row), ai: row.ai_payload ? JSON.parse(row.ai_payload) : undefined })) });
  }
  if (path.startsWith('/api/ratings/') && request.method === 'GET') {
    const id = decodeURIComponent(path.slice('/api/ratings/'.length));
    return json(await ratingResponse(env, id));
  }
  if (path.startsWith('/api/recordings/') && request.method === 'GET') return json({ song: await resolveRecording(env, decodeURIComponent(path.slice('/api/recordings/'.length))) });
  if (path === '/api/audience-summary' && request.method === 'GET') {
    const rows = await env.DB.prepare('SELECT song_id,payload,updated_at FROM audience_aggregates').all<{ song_id: string; payload: string; updated_at: number }>();
    return json({ ratings: rows.results.map(row => ({ id: row.song_id, audience: audienceFromPayload(row.payload) })) });
  }
  if (path === '/api/ratings' && request.method === 'POST') {
    const input = await body(request);
    await turnstile(request, env, input.turnstileToken);
    await reserveAction(env, request, 'generation', 12);
    if (typeof input.songId !== 'string') throw new ApiError(400, 'Select a song.');
    let song: Song;
    try { song = await getSong(env, input.songId); }
    catch (error) { if (!(error instanceof ApiError) || error.status !== 404) throw error; song = await resolveRecording(env, input.songId); }
    const saved = await env.DB.prepare('SELECT song_id FROM ai_ratings WHERE song_id=?').bind(song.id).first();
    if (saved) return json(await ratingResponse(env, song.id));
    await env.DB.prepare('INSERT OR IGNORE INTO generation_jobs(song_id,created_at,updated_at,message) VALUES(?,?,?,?)').bind(song.id, now(), now(), localDev(env) ? 'AI generation will start after the hosted service is configured. Existing estimates are available.' : null).run();
    return json(await ratingResponse(env, song.id), 202);
  }
  if (path === '/api/audience' && request.method === 'POST') return json(await submitVote(request, env, await body(request)));
  if (path.startsWith('/api/my-vote/') && request.method === 'GET') return json({ rating: await currentVote(request, env, decodeURIComponent(path.slice('/api/my-vote/'.length))) });
  if (path === '/api/verifications/preview' && request.method === 'POST') {
    const input = await body(request);
    if (typeof input.token !== 'string') throw new ApiError(400, 'The verification link is invalid.');
    return json(await getPending(env, input.token));
  }
  if (path === '/api/verifications/confirm' && request.method === 'POST') {
    const input = await body(request);
    const result = await confirmVote(env, input.token);
    return json({ status: 'counted', songId: result.songId, rating: await ratingResponse(env, result.songId) }, 200, { 'Set-Cookie': result.cookie });
  }
  if (path === '/api/feedback' && request.method === 'POST') {
    const input = await body(request);
    await turnstile(request, env, input.turnstileToken);
    await reserveAction(env, request, 'feedback', 5);
    const message = z.string().trim().min(10).max(1000).safeParse(input.message);
    if (!message.success || typeof input.songId !== 'string') throw new ApiError(400, 'Describe the problem in 10 to 1,000 characters.');
    await getSong(env, input.songId);
    await env.DB.prepare('INSERT INTO feedback(id,song_id,message,created_at) VALUES(?,?,?,?)').bind(crypto.randomUUID(), input.songId, message.data, now()).run();
    return json({ status: 'received' });
  }
  if (path === '/api/dev/mail' && request.method === 'GET') {
    if (!localDev(env) || !['localhost', '127.0.0.1'].includes(url.hostname)) throw new ApiError(404, 'Not found.');
    return json({ messages: (await env.DB.prepare('SELECT dev_mail.id,dev_mail.verification_url AS url,dev_mail.created_at AS createdAt,songs.title,songs.artist FROM dev_mail JOIN songs ON songs.id=dev_mail.song_id ORDER BY dev_mail.created_at DESC,dev_mail.rowid DESC LIMIT 30').all()).results });
  }
  if (path.startsWith('/api/admin/')) {
    await admin(request, env);
    if (path === '/api/admin/catalog' && request.method === 'GET') {
      const rows = await env.DB.prepare('SELECT songs.*,ai_ratings.payload AS ai_payload FROM songs LEFT JOIN ai_ratings ON songs.id=ai_ratings.song_id ORDER BY songs.title').all<SongRow & { ai_payload: string | null }>();
      return json({ songs: rows.results.map(row => ({ ...songFromRow(row), ai: row.ai_payload ? JSON.parse(row.ai_payload) : undefined })), jobs: (await env.DB.prepare('SELECT status,COUNT(*) AS count FROM generation_jobs GROUP BY status').all()).results });
    }
    if (path === '/api/admin/import' && request.method === 'POST') {
      const input = await body(request);
      const song = input.song as Song;
      if (!song || typeof song.id !== 'string' || !/^(starter:|mb:)[a-z0-9-]+$/.test(song.id) || typeof song.slug !== 'string' || !/^[a-z0-9-]+$/.test(song.slug) || !song.title || !song.artist || !['Hindi', 'English', 'Other'].includes(song.language)) throw new ApiError(400, 'Invalid catalog entry.');
      await insertSong(env, song).run();
      if (song.musicbrainzId) await env.DB.prepare('UPDATE songs SET language=?,aliases_json=? WHERE id=?').bind(song.language, JSON.stringify(song.aliases || []), song.id).run();
      if (song.ai) {
        const parsed = aiOutputSchema.parse({ status: song.ai.status, factors: song.ai.factors, reasons: song.ai.reasons, explanation: song.ai.explanation, tip: song.ai.tip, sourceIds: song.ai.sourceIds });
        if (parsed.status === 'rated') {
          const rating = { ...parsed, overall: overallScore(parsed.factors), model: song.ai.model, generatedAt: song.ai.generatedAt, rubricVersion: RUBRIC_VERSION };
          await env.DB.prepare('INSERT OR IGNORE INTO ai_ratings(song_id,payload,model,rubric_version,generated_at) VALUES(?,?,?,?,?)').bind(song.id, JSON.stringify(rating), rating.model, RUBRIC_VERSION, now()).run();
        }
      }
      return json({ status: 'imported', songId: song.id });
    }
    if (path === '/api/admin/resolve' && request.method === 'POST') {
      const input = await body(request);
      if (typeof input.songId !== 'string') throw new ApiError(400, 'A recording identity is required.');
      return json({ song: await resolveRecording(env, input.songId) });
    }
    if (path === '/api/admin/enqueue' && request.method === 'POST') {
      const input = await body(request);
      if (typeof input.songId !== 'string') throw new ApiError(400, 'Select a song.');
      await getSong(env, input.songId);
      await env.DB.prepare('INSERT OR IGNORE INTO generation_jobs(song_id,created_at,updated_at) SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM ai_ratings WHERE song_id=?)').bind(input.songId, now(), now(), input.songId).run();
      return json({ status: 'queued' });
    }
    if (path === '/api/admin/invalidate-vote' && request.method === 'POST') {
      const input = await body(request);
      if (typeof input.songId !== 'string' || typeof input.emailKey !== 'string') throw new ApiError(400, 'A recording and voter identifier are required.');
      await env.DB.prepare('UPDATE votes SET active=0,updated_at=? WHERE song_id=? AND email_key=?').bind(now(), input.songId, input.emailKey).run();
      return json({ status: 'removed', rating: await ratingResponse(env, input.songId) });
    }
    if (path === '/api/admin/process' && request.method === 'POST') { await processOneJob(env); return json({ status: 'processed' }); }
    if (path === '/api/admin/assessment-preview' && request.method === 'POST') {
      const input = await body(request);
      if (typeof input.songId !== 'string') throw new ApiError(400, 'Select a recording.');
      return json({ assessment: await previewAssessment(env, input.songId) });
    }
    if (path === '/api/admin/recalibrate' && request.method === 'POST') {
      const input = await body(request);
      if (typeof input.songId !== 'string') throw new ApiError(400, 'Select a recording.');
      await getSong(env, input.songId);
      const result = await env.DB.prepare(`INSERT INTO generation_jobs(song_id,created_at,updated_at,refresh_requested) VALUES(?,?,?,1)
        ON CONFLICT(song_id) DO UPDATE SET status='queued',attempts=0,next_attempt_at=0,lease_until=0,lease_token=NULL,message=NULL,refresh_requested=1,updated_at=excluded.updated_at
        WHERE generation_jobs.status!='processing'`).bind(input.songId, now(), now()).run();
      if (!result.meta.changes) throw new ApiError(409, 'An assessment is already processing. Please retry after it completes.');
      return json({ status: 'queued', songId: input.songId });
    }
  }
  throw new ApiError(404, 'This page could not be found.', 'not_found');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return await route(request, env); }
    catch (error) {
      if (error instanceof ApiError) return json({ error: error.message, code: error.code, retryAt: error.retryAt }, error.status, error.retryAt ? { 'Retry-After': String(Math.max(1, Math.ceil((Date.parse(error.retryAt) - Date.now()) / 1000))) } : {});
      if (error instanceof z.ZodError) return json({ error: 'The submitted values are invalid.', code: 'invalid_input' }, 400);
      // Do not log requests, email addresses, raw verification tokens, or provider responses.
      return json({ error: 'The rating service is temporarily unavailable. Your saved estimates and draft remain available.', code: 'service_unavailable' }, 503);
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => { await cleanup(env); await processOneJob(env); })());
  },
};
