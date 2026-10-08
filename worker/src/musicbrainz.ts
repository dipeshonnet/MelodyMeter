import { ApiError, now } from './security';
import type { Env } from './types';
import type { Song } from '../../shared/rating';
import { insertSong } from './store';

const MBID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export async function mbFetch(env: Env, path: string): Promise<Record<string, unknown>> {
  const cached = await env.DB.prepare('SELECT payload FROM source_cache WHERE cache_key=? AND expires_at>?').bind(path, now()).first<{ payload: string }>();
  if (cached) return JSON.parse(cached.payload);
  const acquired = await env.DB.prepare("INSERT INTO locks(name,available_at) VALUES('musicbrainz',?) ON CONFLICT(name) DO UPDATE SET available_at=excluded.available_at WHERE locks.available_at<=? RETURNING name").bind(Date.now() + 1100, Date.now()).first();
  if (!acquired) throw new ApiError(429, 'Song lookup is busy. Please retry in a moment.', 'lookup_busy', new Date(Date.now() + 1500).toISOString());
  const contact = env.MUSICBRAINZ_CONTACT;
  if (!contact || contact.includes('example.com')) throw new ApiError(503, 'New-song lookup needs a configured contact address. The saved catalog is available.', 'lookup_unconfigured');
  const response = await fetch(`https://musicbrainz.org/ws/2/${path}`, { headers: { 'User-Agent': `MelodyMeter/0.1 (${contact})`, 'Accept': 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new ApiError(503, 'The song directory is temporarily unavailable. Try again later.', 'lookup_unavailable');
  const json = await response.json() as Record<string, unknown>;
  await env.DB.prepare('INSERT INTO source_cache(cache_key,payload,expires_at) VALUES(?,?,?) ON CONFLICT(cache_key) DO UPDATE SET payload=excluded.payload,expires_at=excluded.expires_at').bind(path, JSON.stringify(json), now() + 86400).run();
  return json;
}
function lucene(value: string): string { return value.replace(/([+\-!(){}\[\]^"~*?:\\/]|&&|\|\|)/g, '\\$1'); }
function recordingSong(rec: Record<string, unknown>): Song {
  const id = String(rec.id);
  const credits = rec['artist-credit'] as { name?: string; joinphrase?: string; artist?: { name: string } }[] | undefined;
  const artist = credits?.map(a => (a.name || a.artist?.name || '') + (a.joinphrase || '')).join('') || 'Unknown artist';
  const releases = rec.releases as { title?: string; date?: string }[] | undefined;
  const release = releases?.[0];
  const year = release?.date ? Number(release.date.slice(0, 4)) : undefined;
  return { id: `mb:${id}`, slug: `recording-${id}`, title: String(rec.title || 'Untitled'), artist, language: 'Other', album: release?.title || '', year: Number.isFinite(year) ? year : undefined, version: typeof rec.disambiguation === 'string' && rec.disambiguation ? rec.disambiguation : 'Selected MusicBrainz recording', aliases: [], musicbrainzId: id, referenceUrl: `https://musicbrainz.org/recording/${id}`, color: 'blue' };
}
export async function externalSearch(env: Env, query: string): Promise<Song[]> {
  if (query.length < 3 || query.length > 160) throw new ApiError(400, 'Search with 3 to 160 characters.');
  const data = await mbFetch(env, `recording/?query=${encodeURIComponent(lucene(query))}&fmt=json&limit=8`);
  const recordings = data.recordings;
  if (!Array.isArray(recordings)) return [];
  return recordings.map(recordingSong);
}
export async function resolveRecording(env: Env, id: string): Promise<Song> {
  const mbid = id.replace(/^mb:/, '');
  if (!MBID.test(mbid)) throw new ApiError(400, 'Select a recording from the search results.', 'invalid_recording');
  const data = await mbFetch(env, `recording/${mbid}?inc=artist-credits+releases&fmt=json`);
  const song = recordingSong(data);
  await insertSong(env, song).run();
  return song;
}
