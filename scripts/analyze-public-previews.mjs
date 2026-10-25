// Resumable draft analysis. Does not overwrite or publish catalog scores.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');
const python = process.env.MELODYMETER_AUDIO_PYTHON;
if (!python) throw new Error('Set MELODYMETER_AUDIO_PYTHON to a Python runtime; see AUDIO_ANALYSIS.md.');
const output = 'artifacts/public-preview-analysis.json';
mkdirSync('artifacts', { recursive: true });
let songs = JSON.parse(readFileSync('data/launch-catalog.json', 'utf8')).filter(s => !s.ai)
  .sort((a, b) => (b.year || 0) - (a.year || 0));
let rows = [];
try { rows = JSON.parse(readFileSync(output, 'utf8')).results; } catch {}
if (process.env.MELODYMETER_AUDIO_SONGS) {
  const selected = new Set(process.env.MELODYMETER_AUDIO_SONGS.split(','));
  songs = songs.filter(song => selected.has(song.id));
}
const limit = process.argv[2] === undefined ? songs.length : Number(process.argv[2]);
if (!Number.isInteger(limit) || limit < 0) throw new Error('The analysis limit must be a nonnegative integer.');
const normalize = s => s.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
const title = s => normalize(s.replace(/\s*\(from .*?\).*$/i, '').replace(/\s*\(original .*?\).*$/i, ''));
const save = () => {
  writeFileSync(output, JSON.stringify({
    generatedAt: new Date().toISOString(), pendingCatalogSongs: songs.length,
    publishedScoresAdded: 0, description: 'Draft excerpt pitch proxies, not full-song singing ratings.',
    results: rows,
  }, null, 2) + '\n');
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const columns = ['Song', 'Artist', 'Status', 'Partial range score', 'Partial held-note score', 'Clip seconds',
    'Confident pitch seconds', 'Pitch span semitones', 'Store link'];
  const csv = [columns, ...rows.map(r => [r.title, r.artist, r.status, r.observedFactorProxies?.range, r.observedFactorProxies?.sustain,
    r.evidence?.durationSeconds, r.evidence?.confidentPitchSeconds,
    r.evidence?.pitchSpanP5P95Semitones, r.source?.storeUrl])];
  writeFileSync('artifacts/public-preview-analysis.csv', '\ufeff' + csv.map(row => row.map(quote).join(',')).join('\n') + '\n');
};
function analyze(bytes) {
  return new Promise((resolve, reject) => {
    const child = spawn(python, ['scripts/analyze-preview.py'], { windowsHide: true,
      env: { ...process.env, NUMBA_NUM_THREADS: '2', OPENBLAS_NUM_THREADS: '1' } });
    let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Analysis timed out')); }, 180000);
    child.stdout.on('data', b => { stdout += b; });
    child.stderr.on('data', b => { stderr = (stderr + b).slice(-1000); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', () => {
      clearTimeout(timer);
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error(stderr || 'No analysis output')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(bytes);
  });
}
let nextSearchAt = 0;
async function processSong(song) {
  const wait = Math.max(0, nextSearchAt - Date.now());
  nextSearchAt = Math.max(Date.now(), nextSearchAt) + 3200;
  await new Promise(resolve => setTimeout(resolve, wait));
  let row = { songId: song.id, title: song.title, artist: song.artist };
  try {
    const query = new URL('https://itunes.apple.com/search');
    query.search = new URLSearchParams({ term: `${song.title} ${song.artist.split(/,|&/)[0]}`,
      country: song.language === 'Hindi' ? 'IN' : 'US', media: 'music', entity: 'song', limit: '25' });
    const response = await fetch(query, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Preview search HTTP ${response.status}`);
    const results = (await response.json()).results || [];
    const artists = song.artist.split(/,|&| feat\. /i).map(normalize).filter(Boolean);
    const matches = results.filter(r => r.previewUrl && title(r.trackName) === title(song.title)
      && artists.every(a => normalize(r.artistName).includes(a))
      && !/\b(live|karaoke|tribute|remix|instrumental|rerecorded|re-recorded)\b/i.test(`${r.trackName} ${r.collectionName}`));
    const albums = matches.filter(r => song.album && normalize(r.collectionName).includes(normalize(song.album)));
    const chosen = (albums.length ? albums : matches)[0];
    if (!chosen) row.status = 'no_conservative_preview_match';
    else {
      row.source = { provider: 'Apple public preview', trackId: chosen.trackId,
        title: chosen.trackName, artist: chosen.artistName, album: chosen.collectionName,
        storeUrl: chosen.trackViewUrl, previewUrl: chosen.previewUrl,
        identity: 'Title and credited artists match; canonical recording equivalence unverified' };
      const url = new URL(chosen.previewUrl);
      if (url.protocol !== 'https:' || url.hostname !== 'audio-ssl.itunes.apple.com') throw new Error('Unexpected preview host');
      const clip = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!clip.ok) throw new Error(`Preview HTTP ${clip.status}`);
      const bytes = Buffer.from(await clip.arrayBuffer());
      if (bytes.length > 8 * 1024 * 1024) throw new Error('Preview exceeds size limit');
      row = { ...row, ...await analyze(bytes), analyzedAt: new Date().toISOString() };
    }
  } catch (error) { row = { ...row, status: 'request_failed', error: String(error).slice(0,300) }; }
  rows = rows.filter(r => r.songId !== song.id);
  rows.push(row);
  save();
  console.log(JSON.stringify({ completed: rows.length, total: songs.length, title: row.title,
    status: row.status, factors: row.observedFactorProxies }));
}
// Three local CPU jobs share one centrally paced metadata request stream.
const running = new Set();
const pending = songs.filter(song => !rows.some(r => r.songId === song.id
  && r.status !== 'request_failed' && r.status !== 'analysis_failed')
  || process.env.MELODYMETER_AUDIO_SONGS).slice(0, limit);
for (const song of pending) {
  const task = processSong(song).finally(() => running.delete(task));
  running.add(task);
  if (running.size >= 3) await Promise.race(running);
}
await Promise.all(running);
save();
