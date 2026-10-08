import { starterSongs } from '../data/starter';
import { writeFileSync, mkdirSync } from 'node:fs';
import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');
mkdirSync('data/imports', { recursive: true });
const results = [];
for (const song of starterSongs) {
  const escape = (s: string) => s.replace(/["\\]/g, '\\$&');
  const query = `recording:"${escape(song.title)}" AND artist:"${escape(song.artist)}"`;
  try {
    const response = await fetch(`https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=8`, { headers: { 'User-Agent': 'MelodyMeter/0.1 (https://melody.everydayai.work)' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Metadata status ${response.status}`);
    const data = await response.json();
    const choices = data.recordings.map((r: any) => ({ id: r.id, title: r.title, artist: r['artist-credit']?.map((a: any) => (a.name || a.artist?.name || '') + (a.joinphrase || '')).join(''), version: r.disambiguation || '', releases: (r.releases || []).slice(0, 5).map((x: any) => ({ title: x.title, date: x.date, status: x.status })) }));
    results.push({ title: song.title, artist: song.artist, language: song.language, aliases: song.aliases, choices });
    writeFileSync('data/imports/starter-candidates.local.json', JSON.stringify(results, null, 2));
    console.log(song.title, JSON.stringify(choices.slice(0, 2)));
  } catch (error) { console.log(song.title, String(error)); }
  await new Promise(resolve => setTimeout(resolve, 1200));
}
