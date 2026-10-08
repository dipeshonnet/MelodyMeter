import { z } from 'zod';
import { ApiError, hash, now, sessionEmail } from './security';
import { getSong, songFromRow } from './store';
import type { Env, SongRow } from './types';

export async function savedIdentity(request: Request, env: Env) {
  const emailKey = await sessionEmail(request, env);
  if (!emailKey) throw new ApiError(401, 'Sign in to sync your saved songs.', 'sign_in_required');
  return { emailKey, account: await hash(`saved-songs:${emailKey}`) };
}

export async function listSavedSongs(request: Request, env: Env) {
  const { emailKey, account } = await savedIdentity(request, env);
  const rows = await env.DB.prepare(`SELECT songs.*,ai_ratings.payload AS ai_payload FROM saved_songs
    JOIN songs ON songs.id=saved_songs.song_id LEFT JOIN ai_ratings ON ai_ratings.song_id=songs.id
    WHERE saved_songs.email_key=? ORDER BY saved_songs.saved_at DESC,songs.id`).bind(emailKey).all<SongRow & { ai_payload: string | null }>();
  return { account, songs: rows.results.map(row => ({ ...songFromRow(row), ai: row.ai_payload ? JSON.parse(row.ai_payload) : undefined })) };
}

const changesSchema = z.object({
  account: z.string().regex(/^[a-f0-9]{64}$/),
  changes: z.array(z.object({ songId: z.string().regex(/^(starter:|mb:)[a-z0-9-]+$/).max(100), saved: z.boolean() })).min(1).max(50),
});

export async function changeSavedSongs(request: Request, env: Env, input: Record<string, unknown>) {
  const { emailKey, account } = await savedIdentity(request, env);
  const value = changesSchema.parse(input);
  // A queued change from another signed-in account must never affect this one.
  if (value.account !== account) throw new ApiError(409, 'Your signed-in account changed. Reload to sync saved songs.', 'account_changed');
  await Promise.all(value.changes.filter(change => change.saved).map(change => getSong(env, change.songId)));
  await env.DB.batch(value.changes.map(change => change.saved
    ? env.DB.prepare(`INSERT OR IGNORE INTO saved_songs(email_key,song_id,saved_at)
        SELECT ?,id,? FROM songs WHERE id=?`).bind(emailKey, now(), change.songId)
    : env.DB.prepare('DELETE FROM saved_songs WHERE email_key=? AND song_id=?').bind(emailKey, change.songId)));
  return { synced: true };
}
