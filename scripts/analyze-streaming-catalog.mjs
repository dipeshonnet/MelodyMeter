// Public Monochrome playback/search endpoints, documented by its official client.
// No login tokens, cookies, CAPTCHA bypass, or DRM extraction.
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
const python = process.env.MELODYMETER_AUDIO_PYTHON;
if (!python) throw new Error('Set MELODYMETER_AUDIO_PYTHON.');
const catalog = JSON.parse(readFileSync('data/launch-catalog.json', 'utf8'));
const youtube = JSON.parse(readFileSync('artifacts/full-song-analysis.json', 'utf8'));
const durations = JSON.parse(readFileSync('data/song-durations.json', 'utf8'));
const aliases = JSON.parse(readFileSync('data/audio-title-aliases.json', 'utf8'));
const artistAliases = JSON.parse(readFileSync('data/audio-artist-aliases.json', 'utf8'));
const discover = process.argv.includes('--discover-only');
const neural = process.argv.includes('--neural-vocals');
const path = discover ? 'artifacts/streaming-source-discovery.json' : neural ? 'artifacts/neural-streaming-audio-analysis.json' : 'artifacts/streaming-audio-analysis.json';
const report = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : { results: [] };
const inputRoot = resolve(neural ? 'artifacts/neural-streaming-inputs' : 'artifacts/streaming-inputs'); mkdirSync(inputRoot, { recursive: true });
const normalize = value => value.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '');
const variant = /\b(?:live|karaoke|cover|remix|instrumental|re-?recorded|tribute|mashup|medley|slowed|sped|lo-?fi)\b/i;
const selected = process.env.MELODYMETER_AUDIO_SONGS ? new Set(process.env.MELODYMETER_AUDIO_SONGS.split(',')) : null;
const all = process.argv.includes('--all');
const force = process.argv.includes('--force');
const retry = process.argv.includes('--retry-unavailable');
const concurrency = discover ? 1 : Math.max(1, Math.min(2, Number(process.env.MELODYMETER_AUDIO_CONCURRENCY) || 2));
let nextSearch = 0;
function matches(song, track) {
  const artists = song.artist.split(/,|&|\sfeat\.?\s|\sfeaturing\s/i).map(s => s.trim()).filter(Boolean);
  const excluded = [song.album, song.artist, ...artists].map(normalize);
  const titles = [song.title, ...song.aliases.filter(alias => !excluded.includes(normalize(alias))), ...(aliases.find(a => a.songId === song.id)?.titles || [])];
  const artistIdentity = value => normalize(value.replace(/\band\b/gi, ' '));
  const names = (track.artistNames || track.artists?.map(a => a.name) || []).map(artistIdentity);
  return track.playable !== false && !variant.test(track.title) && titles.some(title => normalize(title).length >= 4 && normalize(track.title).includes(normalize(title))) &&
    (names.includes(artistIdentity(song.artist)) || artists.every(artist => [artist, ...(artistAliases.find(a => normalize(a.artist) === normalize(artist))?.aliases || [])].some(name => names.includes(artistIdentity(name)))));
}
function save(row) {
  report.results = [...report.results.filter(r => r.songId !== row.songId), row]; report.generatedAt = new Date().toISOString();
  writeFileSync(path, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ title: row.title, status: row.status, factors: row.observedFactorProxies, checked: report.results.length }));
}
function analyze(file) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(python, ['scripts/analyze-preview.py', '--full-recording', '--complete-estimates', ...(neural ? ['--neural-vocals'] : []), '--file', file],
      { windowsHide: true, env: { ...process.env, OPENBLAS_NUM_THREADS: '1', NUMBA_NUM_THREADS: '2' } });
    let out = '', err = '', remaining = 1800000, last = Date.now();
    const timer = setInterval(() => { const now = Date.now(), gap = now - last; last = now; if (gap <= 10000) remaining -= gap; if (remaining <= 0) { clearInterval(timer); child.kill(); reject(new Error('Audio analysis timeout')); } }, 2000);
    child.stdout.on('data', data => out += data); child.stderr.on('data', data => err = (err + data).slice(-2000));
    child.on('error', error => { clearInterval(timer); reject(error); });
    child.on('close', code => { clearInterval(timer); if (code) reject(new Error(err || out)); else resolveResult(JSON.parse(out)); });
  });
}
async function download(audioUrl) {
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const audio = await fetch(audioUrl, { signal: AbortSignal.timeout(180000) });
      if (!audio.ok) throw new Error(`Playback HTTP ${audio.status}`);
      const reader = audio.body.getReader(), buffers = []; let bytes = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > 150 * 1024 * 1024) { await reader.cancel(); throw new Error('Recording exceeds 150 MB limit'); }
        buffers.push(value);
      }
      return Buffer.concat(buffers);
    } catch (error) {
      lastError = error;
      if (/150 MB|HTTP (?:401|403|404)/.test(String(error))) throw error;
      if (!attempt) await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
  throw lastError;
}
const pending = catalog.filter(song => {
  if (selected ? !selected.has(song.id) : !all && youtube.results.find(r => r.songId === song.id)?.status === 'partial_excerpt_only') return false;
  const prior = report.results.find(r => r.songId === song.id);
  return force || !prior || prior.status === 'streaming_analysis_failed' || (retry && prior.status !== 'complete_audio_estimate');
});
async function processSong(song) {
  const file = resolve(inputRoot, `${song.id.slice(3)}.audio`);
  if (!/^mb:[a-f0-9-]{36}$/.test(song.id) || !file.startsWith(inputRoot + sep)) throw new Error('Invalid temporary audio path.');
  let row = { songId: song.id, title: song.title, artist: song.artist, scope: 'full_recording' };
  try {
    const reference = durations.find(r => r.songId === song.id);
    if (!reference?.seconds) { save({ ...row, status: 'canonical_duration_unavailable' }); return; }
    const searchDelay = Math.max(0, nextSearch - Date.now());
    nextSearch = Math.max(Date.now(), nextSearch) + 2000;
    await new Promise(resolveDelay => setTimeout(resolveDelay, searchDelay));
    const search = new URL('https://tracks.monochrome.st/search/tracks');
    search.search = new URLSearchParams({ q: `${song.title} ${song.artist.split(',')[0]}`, limit: '25' });
    const response = await fetch(search, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Search HTTP ${response.status}`);
    const tracks = (await response.json()).tracks || [];
    const candidates = tracks.filter(track => matches(song, track) && typeof track.duration === 'number' && track.duration / 1000 >= reference.seconds - Math.max(8, reference.seconds * .04) && track.duration / 1000 <= reference.seconds + Math.max(60, reference.seconds * .4) && track.duration <= 900000);
    candidates.sort((a, b) => Math.abs(a.duration / 1000 - reference.seconds) - Math.abs(b.duration / 1000 - reference.seconds));
    const track = candidates[0];
    if (!track || !/^\d+$/.test(String(track.trackId || track.id))) { save({ ...row, status: 'no_conservative_streaming_match' }); return; }
    const id = String(track.trackId || track.id), audioUrl = `https://tracks.monochrome.st/track/${id}`;
    if (discover) {
      save({ ...row, status: 'matched_full_recording_needs_analysis', matchedAt: new Date().toISOString(),
        source: { storeUrl: `https://monochrome.st/track/${id}`, audioUrl, trackId: id, title: track.title, artist: (track.artistNames || []).join(', '), isrc: track.isrc || null,
          durationSeconds: track.duration / 1000, expectedSongSeconds: reference.seconds, durationReferenceUrl: reference.sourceUrl,
          matchBasis: 'Title, all credited artists, and metadata duration matched; full audio has not yet been analyzed.' } });
      return;
    }
    writeFileSync(file, await download(audioUrl));
    const result = await analyze(file);
    const decoded = result.evidence?.durationSeconds ?? result.durationSeconds;
    if (typeof decoded !== 'number' || Math.abs(decoded - track.duration / 1000) > 3) throw new Error(`Decoded recording duration ${decoded}s differs from the matched ${track.duration / 1000}s track.`);
    row = { ...row, ...result, analyzedAt: new Date().toISOString(), durationValidated: true,
      source: { storeUrl: `https://monochrome.st/track/${id}`, audioUrl, trackId: id, isrc: track.isrc || null,
        title: track.title, artist: (track.artistNames || []).join(', '), expectedSongSeconds: reference.seconds, durationReferenceUrl: reference.sourceUrl,
        matchBasis: 'Public Monochrome track title and all credited artists matched; reviewed artist spellings allowed. Duration checked; canonical recording equivalence unverified.' } };
  } catch (error) { row = { ...row, status: 'streaming_analysis_failed', error: String(error).slice(0, 500) }; }
  finally { if (existsSync(file)) unlinkSync(file); }
  save(row);
  await new Promise(resolveDelay => setTimeout(resolveDelay, 2000));
}
const running = new Set();
for (const song of pending) {
  const task = processSong(song).finally(() => running.delete(task));
  running.add(task);
  if (running.size >= concurrency) await Promise.race(running);
}
await Promise.all(running);
