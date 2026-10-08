import { FACTOR_IDS, audienceFromPayload, type AIRating, type Song, type VoteInput } from '../../shared/rating';
import type { Env, SongRow } from './types';
import { ApiError, now } from './security';

export function songFromRow(row: SongRow): Song {
  return { id: row.id, slug: row.slug, title: row.title, artist: row.artist, language: row.language, album: row.album, year: row.year ?? undefined, version: row.version, aliases: JSON.parse(row.aliases_json), musicbrainzId: row.musicbrainz_id ?? undefined, referenceUrl: row.reference_url ?? undefined, color: row.color };
}
export async function getSong(env: Env, id: string): Promise<Song> {
  const row = await env.DB.prepare('SELECT * FROM songs WHERE id=?').bind(id).first<SongRow>();
  if (!row) throw new ApiError(404, 'This song has not been added yet.', 'song_not_found');
  return songFromRow(row);
}
export function insertSong(env: Env, song: Song): D1PreparedStatement {
  return env.DB.prepare('INSERT OR IGNORE INTO songs(id,slug,title,artist,language,album,year,version,aliases_json,musicbrainz_id,reference_url,color,search_text) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(song.id, song.slug, song.title, song.artist, song.language, song.album, song.year ?? null, song.version, JSON.stringify(song.aliases), song.musicbrainzId ?? null, song.referenceUrl ?? null, song.color, [song.title, song.artist, song.album, ...song.aliases].join(' ').normalize('NFKD').toLowerCase());
}
export async function ratingResponse(env: Env, id: string) {
  const [song, ai, aggregate, job] = await Promise.all([
    getSong(env, id),
    env.DB.prepare('SELECT payload FROM ai_ratings WHERE song_id=?').bind(id).first<{ payload: string }>(),
    env.DB.prepare('SELECT payload,updated_at FROM audience_aggregates WHERE song_id=?').bind(id).first<{ payload: string; updated_at: number }>(),
    env.DB.prepare('SELECT status,next_attempt_at,message FROM generation_jobs WHERE song_id=?').bind(id).first<{ status: string; next_attempt_at: number; message: string | null }>(),
  ]);
  const audience = audienceFromPayload(aggregate?.payload ?? null);
  if (aggregate) audience.updatedAt = new Date(aggregate.updated_at * 1000).toISOString();
  return { song, ai: ai ? JSON.parse(ai.payload) as AIRating : null, audience, job: job ? { status: job.status, retryAt: job.next_attempt_at > now() ? new Date(job.next_attempt_at * 1000).toISOString() : undefined, message: job.message ?? undefined } : undefined };
}
export function voteValues(vote: VoteInput): (number | null)[] {
  return [vote.overall, ...FACTOR_IDS.map(id => vote.factors[id] ?? null)];
}
export function upsertVote(env: Env, songId: string, emailKey: string, vote: VoteInput): D1PreparedStatement {
  return env.DB.prepare(`INSERT INTO votes(song_id,email_key,overall,${FACTOR_IDS.join(',')},updated_at) VALUES(${Array(13).fill('?').join(',')}) ON CONFLICT(song_id,email_key) DO UPDATE SET overall=excluded.overall,${FACTOR_IDS.map(id => `${id}=excluded.${id}`).join(',')},updated_at=excluded.updated_at`).bind(songId, emailKey, ...voteValues(vote), now());
}
