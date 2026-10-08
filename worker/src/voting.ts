import { FACTOR_IDS, voteSchema, type VoteInput } from '../../shared/rating';
import { ApiError, assertToken, hash, identityKey, localDev, normalizeEmail, now, randomToken, sessionCookie, sessionEmail, turnstile } from './security';
import { getSong, ratingResponse, upsertVote } from './store';
import { reserveAction, reserveEmail } from './budgets';
import type { Env, PendingRow } from './types';

export async function submitVote(request: Request, env: Env, input: Record<string, unknown>) {
  const vote = voteSchema.safeParse(input.rating);
  if (!vote.success) throw new ApiError(400, 'Choose an overall score from 1 to 10. Optional scores must also be from 1 to 10.', 'invalid_rating');
  if (typeof input.songId !== 'string') throw new ApiError(400, 'Choose a song first.');
  const song = await getSong(env, input.songId);
  await turnstile(request, env, input.turnstileToken);
  const verifiedKey = await sessionEmail(request, env);
  // An authenticated identity is chosen by the server. A client cannot swap in another email.
  if (verifiedKey && !input.email) {
    await reserveAction(env, request, 'vote', 60);
    await upsertVote(env, song.id, verifiedKey, vote.data).run();
    return { status: 'counted', rating: await ratingResponse(env, song.id) };
  }
  if (typeof input.email !== 'string') throw new ApiError(400, 'Enter your email to verify your rating.', 'email_required');
  const email = normalizeEmail(input.email);
  const emailKey = await identityKey(email, env.EMAIL_HMAC_SECRET);
  if (verifiedKey === emailKey) {
    await reserveAction(env, request, 'vote', 60);
    await upsertVote(env, song.id, emailKey, vote.data).run();
    return { status: 'counted', rating: await ratingResponse(env, song.id) };
  }
  if (!localDev(env) && (!env.RESEND_API_KEY || !env.MAIL_FROM || env.MAIL_FROM.includes('example.com'))) throw new ApiError(503, 'Email verification is not configured yet. Your draft is saved on this device.', 'verification_unconfigured');
  await reserveEmail(env, emailKey, request);
  const token = randomToken();
  const tokenHash = await hash(token);
  const expires = now() + 1800;
  await env.DB.prepare('INSERT INTO pending_verifications(token_hash,email_key,song_id,scores_json,created_at,expires_at) VALUES(?,?,?,?,?,?)').bind(tokenHash, emailKey, song.id, JSON.stringify(vote.data), now(), expires).run();
  const verificationUrl = new URL('/verify/', env.APP_ORIGIN);
  // Keep tokens out of page request URLs/referrers. The browser reads the URL fragment.
  verificationUrl.hash = `token=${token}`;
  try {
    if (localDev(env)) {
      await env.DB.prepare('INSERT INTO dev_mail(id,song_id,verification_url,created_at) VALUES(?,?,?,?)').bind(crypto.randomUUID(), song.id, verificationUrl.href, now()).run();
    } else {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { 'Authorization': `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': `vote-${tokenHash}` },
        body: JSON.stringify({ from: env.MAIL_FROM, to: [email], subject: 'Confirm your MelodyMeter rating', text: `Confirm your ease-of-singing rating for ${song.title} by ${song.artist}.\n\n${verificationUrl.href}\n\nThis link expires in 30 minutes. Open it and press Confirm rating to count your vote. Opening the link alone does not submit a vote. If you did not request it, ignore this email.\n\nMelodyMeter uses your email only to verify ratings.` }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('delivery_failed');
    }
  } catch {
    await env.DB.prepare('DELETE FROM pending_verifications WHERE token_hash=?').bind(tokenHash).run();
    throw new ApiError(503, 'The email could not be sent. Your draft is saved; please retry in a minute.', 'email_unavailable', new Date((now() + 60) * 1000).toISOString());
  }
  return { status: 'verification_required', expiresAt: new Date(expires * 1000).toISOString(), localMailbox: localDev(env) };
}

export async function getPending(env: Env, token: string) {
  assertToken(token);
  const row = await env.DB.prepare('SELECT * FROM pending_verifications WHERE token_hash=?').bind(await hash(token)).first<PendingRow>();
  if (!row || row.expires_at <= now()) throw new ApiError(410, 'This verification link has expired. Submit your saved draft again.', 'expired_token');
  if (row.consumed_at !== null) throw new ApiError(409, 'This rating has already been confirmed.', 'used_token');
  return { song: await getSong(env, row.song_id), rating: voteSchema.parse(JSON.parse(row.scores_json)), expiresAt: new Date(row.expires_at * 1000).toISOString() };
}

export async function confirmVote(env: Env, token: unknown): Promise<{ cookie: string; songId: string }> {
  assertToken(token);
  const tokenHash = await hash(token);
  const sessionToken = randomToken();
  const sessionHash = await hash(sessionToken);
  const time = now();
  // Every statement gates on the same unconsumed, unexpired token. D1 batches are atomic.
  // No preliminary read/consume race: a concurrent second batch selects zero rows.
  const fields = ['overall', ...FACTOR_IDS];
  const statements = [
    env.DB.prepare(`INSERT INTO votes(song_id,email_key,${fields.join(',')},updated_at)
      SELECT song_id,email_key,json_extract(scores_json,'$.overall'),${FACTOR_IDS.map(id => `json_extract(scores_json,'$.factors.${id}')`).join(',')},?
      FROM pending_verifications WHERE token_hash=? AND consumed_at IS NULL AND expires_at>?
      ON CONFLICT(song_id,email_key) DO UPDATE SET ${fields.map(id => `${id}=excluded.${id}`).join(',')},updated_at=excluded.updated_at`)
      .bind(time, tokenHash, time),
    env.DB.prepare('INSERT INTO sessions(token_hash,email_key,expires_at) SELECT ?,email_key,? FROM pending_verifications WHERE token_hash=? AND consumed_at IS NULL AND expires_at>?').bind(sessionHash, time + 2592000, tokenHash, time),
    env.DB.prepare('UPDATE pending_verifications SET consumed_at=? WHERE token_hash=? AND consumed_at IS NULL AND expires_at>? RETURNING song_id').bind(time, tokenHash, time),
  ];
  const results = await env.DB.batch(statements);
  if (!results[0].meta.changes) throw new ApiError(410, 'This link is expired or has already been used. Return to your song to submit a new rating.', 'invalid_or_used_token');
  const songId = (results[2].results[0] as { song_id: string }).song_id;
  return { cookie: sessionCookie(sessionToken, env), songId };
}

export async function currentVote(request: Request, env: Env, songId: string): Promise<VoteInput | null> {
  const key = await sessionEmail(request, env);
  if (!key) return null;
  const row = await env.DB.prepare('SELECT * FROM votes WHERE song_id=? AND email_key=?').bind(songId, key).first<Record<string, unknown>>();
  if (!row) return null;
  return { overall: row.overall as number, factors: Object.fromEntries(FACTOR_IDS.filter(id => row[id] !== null).map(id => [id, row[id] as number])) };
}
