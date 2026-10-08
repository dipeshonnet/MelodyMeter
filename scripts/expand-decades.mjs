import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');
const selections = JSON.parse(readFileSync('data/decade-selections.json', 'utf8'));
const original = JSON.parse(readFileSync('data/launch-catalog.json', 'utf8'));
mkdirSync('data/imports', { recursive: true });
const cachePath = 'data/imports/decade-metadata.json';
const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};
const normalize = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const transliterate = value => normalize(value).replace(/aa/g, 'a').replace(/ee/g, 'i').replace(/oo/g, 'u').replace(/ai/g, 'e').replace(/y/g, 'i');
const similarity = (a, b) => {
  a = transliterate(a); b = transliterate(b);
  if (a === b) return 1;
  const grams = s => new Set(Array.from({length: Math.max(0, s.length - 1)}, (_, i) => s.slice(i, i + 2)));
  const first = grams(a), second = grams(b);
  return 2 * [...first].filter(g => second.has(g)).length / (first.size + second.size || 1);
};
const quote = s => '"' + s.replace(/["\\]/g, ' ') + '"';
let nextRequest = 0;
async function search(title, artist, loose = false, decade) {
  const key = `${title}|${artist}|${loose}${decade ? '|'+decade : ''}`;
  if (cache[key]) return cache[key];
  const baseQuery = loose ? `recording:(${title.replace(/[^\p{L}\p{N} ]/gu, ' ')}) AND artist:${quote(artist)}` : `recording:${quote(title)} AND artist:${quote(artist)}`;
  const query = baseQuery + (decade ? ` AND firstreleasedate:[${decade} TO ${Number(decade) + 9}]` : '');
  for (let attempt = 0; attempt < 4; attempt++) {
    await new Promise(r => setTimeout(r, Math.max(0, nextRequest - Date.now())));
    nextRequest = Date.now() + 1300;
    try {
      const response = await fetch(`https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(query)}&fmt=json&limit=50`, { headers: { 'User-Agent': 'MelodyMeter/1.0 (https://melody.everydayai.work)' }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`MusicBrainz ${response.status}`);
      cache[key] = await response.json();
      writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n');
      return cache[key];
    } catch (error) { if (attempt === 3) throw error; await new Promise(r => setTimeout(r, 2500 * (attempt + 1))); }
  }
}
const chosen = new Map(original.map(song => [song.id, song]));
const evidence = [];
const misses = [];
for (const [decade, languages] of Object.entries(selections)) {
  for (const [language, candidates] of Object.entries(languages)) {
    let count = 0;
    for (const [title, artist, year, album] of candidates) {
      const existing = original.find(s => s.language === language && similarity(s.title, title) > .97 && similarity(s.artist, artist) > .7);
      let matches = (await search(title, artist)).recordings || [];
      const viable = recordings => recordings.filter(r => {
        const credited = (r['artist-credit'] || []).map(c => `${c.name || ''} ${c.artist?.name || ''}`).join(' ');
        return similarity(r.title, title) >= .73 && (normalize(credited).includes(normalize(artist)) || similarity(credited, artist) >= .65) && !/\blive\b|karaoke|instrumental|tribute|demo|remix|\bmix\b|lofi|revival|rehearsal|acoustic|cover|sped up|slowed|2\.0|3\.0/i.test(`${r.disambiguation || ''} ${r.title}`);
      });
      if (!viable(matches).length && !existing) matches = [...matches, ...((await search(title, artist, true)).recordings || [])];
      const ranked = viable(matches).map(r => {
        const date = r['first-release-date'] || '';
        const albumMatch = (r.releases || []).some(release => album && similarity(release.title, album) > .8);
        const dated = date && Number(date.slice(0, 4)) === year;
        const decadesAgree = date && Math.floor(Number(date.slice(0, 4)) / 10) * 10 === Number(decade);
        return { r, score: similarity(r.title, title) * 20 + (albumMatch ? 6 : 0) + (dated ? 12 : decadesAgree ? 4 : 0) + (!r.disambiguation ? 2 : 0) };
      }).sort((a, b) => b.score - a.score);
      const recording = existing ? matches.find(r => r.id === existing.musicbrainzId) || ranked[0]?.r : ranked[0]?.r;
      if (!recording && !existing) { misses.push({ decade, language, title, artist }); console.log(`SKIP ${language} ${year}: ${title}`); continue; }
      const mbid = existing?.musicbrainzId || recording.id;
      const id = `mb:${mbid}`;
      if (!existing && chosen.has(id)) continue;
      // Curated original-release year is separate from dates of later compilations.
      // Preserve the existing recording identity, assessment, and practice resources.
      const song = { ...(existing || {}), id, slug: `recording-${mbid}`, title, artist: existing?.artist || (recording['artist-credit'] || []).map(c => (c.name || c.artist?.name || '') + (c.joinphrase || '')).join('') || artist, language, album, year, version: 'Original studio lead melody', aliases: [...new Set([...(existing?.aliases || []), recording?.title || title, artist, album].filter(Boolean))], musicbrainzId: mbid, referenceUrl: `https://musicbrainz.org/recording/${mbid}`, color: existing?.color || (language === 'Hindi' ? 'amber' : 'teal') };
      chosen.set(id, song);
      evidence.push({ songId: id, title, artist, originalYear: year, album, decade: Number(decade), language, recordingTitle: recording?.title, recordingArtist: recording?.['artist-credit'], musicbrainzFirstRelease: recording?.['first-release-date'], releases: recording?.releases, referenceUrl: song.referenceUrl, yearBasis: 'Curated original song/film release; compilation dates are not used' });
      count++;
      console.log(`${language} ${decade}s ${count}/20: ${title} (${mbid})`);
      writeFileSync('data/imports/decade-catalog.json', JSON.stringify([...chosen.values()], null, 2) + '\n');
      writeFileSync('data/imports/decade-evidence.json', JSON.stringify({ evidence, misses }, null, 2) + '\n');
      if (count >= 20) break;
    }
    if (count < 20) console.log(`INCOMPLETE ${language} ${decade}s: ${count}/20`);
  }
}
const songs = [...chosen.values()];
const census = Object.keys(selections).map(decade => ({ decade: `${decade}s`, Hindi: songs.filter(s => s.language === 'Hindi' && Math.floor(s.year / 10) * 10 === Number(decade)).length, English: songs.filter(s => s.language === 'English' && Math.floor(s.year / 10) * 10 === Number(decade)).length }));
console.log(JSON.stringify({ census, total: songs.length, misses }, null, 2));
if (census.some(row => row.Hindi < 20 || row.English < 20)) process.exitCode = 1;
else writeFileSync('data/launch-catalog.json', JSON.stringify(songs, null, 2) + '\n');
