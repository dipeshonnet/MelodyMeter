import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');
mkdirSync('data/imports', { recursive: true });
const results = [];
for (const song of JSON.parse(readFileSync('data/easy-song-candidates.json'))) {
  const escape = s => s.replace(/["\\]/g, '\\$&');
  const query = `recording:"${escape(song.title)}" AND artist:"${escape(song.artist)}" AND NOT comment:live`;
  try {
    const response = await fetch(`https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=100`, { headers: { 'User-Agent': 'MelodyMeter/0.1 (https://melody.everydayai.work)' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Metadata status ${response.status}`);
    const data = await response.json();
    const choices = data.recordings.map(r => ({ id: r.id, title: r.title, artist: r['artist-credit']?.map(a => (a.name || a.artist?.name || '') + (a.joinphrase || '')).join(''), version: r.disambiguation || '', releases: (r.releases || []).map(x => ({ title: x.title, date: x.date, status: x.status })) }));
    const relevant = choices.filter(c => !/live|remix|demo|karaoke|instrumental|rehears|outtake|DJ.mix/i.test(c.version + ' ' + c.title) && c.releases.some(r => r.title.toLowerCase().includes(song.albumHint.toLowerCase())));
    results.push({ ...song, choices });
    writeFileSync('data/imports/easy-candidates.local.json', JSON.stringify(results, null, 2));
    console.log(song.title, JSON.stringify(relevant.slice(0, 3).map(c => ({ id: c.id, title: c.title, artist: c.artist, version: c.version, releases: c.releases.slice(0, 5) }))));
  } catch (error) { console.log(song.title, String(error)); }
  await new Promise(resolve => setTimeout(resolve, 1200));
}
