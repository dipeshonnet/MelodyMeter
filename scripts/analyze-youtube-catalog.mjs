// Resumable whole-catalog analysis of matching public artist/label uploads.
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { spawn } from 'node:child_process';
const python = process.env.MELODYMETER_AUDIO_PYTHON;
if (!python) throw new Error('Set MELODYMETER_AUDIO_PYTHON.');
const catalog = JSON.parse(readFileSync('data/launch-catalog.json', 'utf8'));
const sources = JSON.parse(readFileSync('data/full-song-sources.json', 'utf8'));
const practice = JSON.parse(readFileSync('data/song-resources.json', 'utf8'));
const titleAliases = JSON.parse(readFileSync('data/audio-title-aliases.json', 'utf8'));
const artistAliases = JSON.parse(readFileSync('data/audio-artist-aliases.json', 'utf8'));
const sourceOverrides = existsSync('data/audio-source-overrides.json') ? JSON.parse(readFileSync('data/audio-source-overrides.json', 'utf8')) : [];
const complete = process.argv.includes('--complete-estimates');
const neural = process.argv.includes('--neural-vocals');
const reportPath = complete ? (neural ? 'artifacts/neural-complete-audio-analysis.json' : 'artifacts/complete-audio-analysis.json') : 'artifacts/full-song-analysis.json';
const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : { results: [] };
const inputRoot = resolve(neural ? 'artifacts/neural-inputs' : 'artifacts/youtube-inputs');
const lengthsPath = 'data/song-durations.json';
const lengths = existsSync(lengthsPath) ? JSON.parse(readFileSync(lengthsPath, 'utf8')) : [];
mkdirSync(inputRoot, { recursive: true });
const force = process.argv.includes('--force');
const retry = process.argv.includes('--retry-unavailable');
const selected = process.env.MELODYMETER_AUDIO_SONGS ? new Set(process.env.MELODYMETER_AUDIO_SONGS.split(',')) : null;
const concurrency = Math.max(1, Math.min(6, Number(process.env.MELODYMETER_AUDIO_CONCURRENCY) || 3));
const normalize = value => value.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '');
const artistNames = song => song.artist.split(/,|&|\sfeat\.?\s|\sfeaturing\s/i).map(name => name.trim()).filter(Boolean);
const variant = /\b(?:live|karaoke|tribute|cover|remix|instrumental|rerecorded|re-recorded|reaction|tutorial|teaser|shorts|mashup|medley|slowed|sped|lofi|lo-fi|8d)\b/i;
function videoUrl(value) {
  try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'www.youtube.com'
    && url.pathname === '/watch' && /^[\w-]{11}$/.test(url.searchParams.get('v') || ''); } catch { return false; }
}
function matchesTitle(song, title) {
  const excluded = [song.artist, song.album, ...artistNames(song)].filter(Boolean).map(normalize);
  const titles = [song.title.replace(/\s*\((?:male|female|original).*?\)/ig, ''),
    ...(titleAliases.find(entry => entry.songId === song.id)?.titles || []),
    ...song.aliases.filter(alias => !excluded.includes(normalize(alias)))];
  return titles.some(value => normalize(value).length >= 4 && normalize(title).includes(normalize(value)));
}
function matchesArtists(song, metadata) {
  const artistIdentity = value => normalize(value.replace(/\band\b/gi, ' ')) || normalize(value);
  const text = artistIdentity(`${metadata.title} ${metadata.channel} ${metadata.description || ''}`);
  return artistNames(song).every(artist => [artist, ...(artistAliases.find(entry => normalize(entry.artist) === normalize(artist))?.aliases || [])].map(artistIdentity).some(name => text.includes(name)));
}
function run(args) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(python, args, { windowsHide: true,
      env: { ...process.env, OPENBLAS_NUM_THREADS: '1', NUMBA_NUM_THREADS: '2' } });
    let stdout = '', stderr = '';
    let remaining = neural ? 1800000 : 300000, lastTick = Date.now();
    const timer = setInterval(() => {
      const now = Date.now(), elapsed = now - lastTick;
      lastTick = now;
      // A large event-loop gap can be a sleeping host; exclude that pause.
      if (elapsed > 0 && elapsed <= 10000) remaining -= elapsed;
      if (remaining <= 0) { clearInterval(timer); child.kill(); reject(new Error('Full-recording job timed out')); }
    }, 2000);
    child.stdout.on('data', b => { stdout += b; });
    child.stderr.on('data', b => { stderr = (stderr + b).slice(-2000); });
    child.on('error', error => { clearInterval(timer); reject(error); });
    child.on('close', code => { clearInterval(timer); code === 0 ? resolveResult(stdout) : reject(new Error(stderr || stdout)); });
  });
}
const downloader = ['-c', "import sys; sys.path.insert(0,'artifacts/youtube-python'); import yt_dlp; yt_dlp.main()",
  '--ignore-config', '--no-playlist', '--socket-timeout', '20', '--retries', '1', '--fragment-retries', '1', '--quiet',
  '--js-runtimes', `node:${process.execPath}`];
let nextSearch = 0;
let nextMetadata = 0;
const sourceLookupErrors = new Map();
let musicBrainzQueue = Promise.resolve();
let nextAppleLookup = 0;
async function appleDuration(song) {
  const delay = Math.max(0, nextAppleLookup - Date.now());
  nextAppleLookup = Math.max(Date.now(), nextAppleLookup) + 3200;
  await new Promise(resolveDelay => setTimeout(resolveDelay, delay));
  const url = new URL('https://itunes.apple.com/search');
  url.search = new URLSearchParams({ term: `${song.title} ${artistNames(song)[0]}`,
    country: song.language === 'Hindi' ? 'IN' : 'US', media: 'music', entity: 'song', limit: '25' });
  const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`Alternate duration lookup failed: HTTP ${response.status}`);
  const matches = ((await response.json()).results || []).filter(track => track.trackTimeMillis >= 60000
    && matchesTitle(song, track.trackName || '') && matchesArtists(song, { title: track.trackName, channel: track.artistName, description: track.collectionName })
    && !variant.test(`${track.trackName} ${track.collectionName}`));
  const track = matches.find(track => song.album && normalize(track.collectionName || '').includes(normalize(song.album))) || matches[0];
  return track ? { seconds: track.trackTimeMillis / 1000, sourceUrl: track.trackViewUrl,
    referenceBasis: 'Apple release title and credited artists matched; canonical recording equivalence unverified' } : { seconds: null, sourceUrl: url.href };
}
async function recordingSeconds(song) {
  const saved = lengths.find(entry => entry.songId === song.id);
  if (saved?.seconds) return saved.seconds;
  const request = musicBrainzQueue.then(async () => {
    const url = `https://musicbrainz.org/ws/2/recording/${song.musicbrainzId}?fmt=json`;
    const response = await fetch(url, { headers: { 'User-Agent': 'MelodyMeter/0.1 (https://melody.everydayai.work)' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) {
      if (![404, 503].includes(response.status)) throw new Error(`Recording duration lookup failed: HTTP ${response.status}`);
      const alternate = { songId: song.id, ...await appleDuration(song) };
      if (saved) lengths[lengths.indexOf(saved)] = alternate; else lengths.push(alternate);
      writeFileSync(lengthsPath, JSON.stringify(lengths, null, 2) + '\n');
      return alternate.seconds;
    }
    const entry = await response.json();
    const canonicalRedirect = response.redirected && new URL(response.url).hostname === 'musicbrainz.org'
      && new URL(response.url).pathname === `/ws/2/recording/${entry.id}`;
    if (entry.id !== song.musicbrainzId && !canonicalRedirect) throw new Error('Recording duration identity mismatch.');
    let seconds = typeof entry.length === 'number' && entry.length >= 60000 ? entry.length / 1000 : null;
    let sourceUrl = response.url;
    if (!seconds) {
      await new Promise(resolveDelay => setTimeout(resolveDelay, 1200));
      const releasesResponse = await fetch(url + '&inc=releases', { headers: { 'User-Agent': 'MelodyMeter/0.1 (https://melody.everydayai.work)' }, signal: AbortSignal.timeout(20000) });
      if (releasesResponse.ok) {
        const recording = await releasesResponse.json();
        for (const release of (recording.releases || []).slice(0, 3)) {
          await new Promise(resolveDelay => setTimeout(resolveDelay, 1200));
          const releaseUrl = `https://musicbrainz.org/ws/2/release/${release.id}?inc=recordings&fmt=json`;
          const releaseResponse = await fetch(releaseUrl, { headers: { 'User-Agent': 'MelodyMeter/0.1 (https://melody.everydayai.work)' }, signal: AbortSignal.timeout(20000) });
          if (!releaseResponse.ok) continue;
          const releaseData = await releaseResponse.json();
          const track = (releaseData.media || []).flatMap(medium => medium.tracks || []).find(track => track.recording?.id === entry.id && track.length >= 60000);
          if (track) { seconds = track.length / 1000; sourceUrl = releaseUrl; break; }
        }
      }
    }
    const lengthEntry = seconds ? { songId: song.id, seconds, sourceUrl }
      : { songId: song.id, ...await appleDuration(song) };
    if (saved) lengths[lengths.indexOf(saved)] = lengthEntry; else lengths.push(lengthEntry);
    writeFileSync(lengthsPath, JSON.stringify(lengths, null, 2) + '\n');
    return lengthEntry.seconds;
  });
  musicBrainzQueue = request.catch(() => {}).then(() => new Promise(resolveDelay => setTimeout(resolveDelay, 1200)));
  return request;
}
function fullLength(duration, expected) { return duration >= expected - Math.max(8, expected * 0.04) && duration <= expected + Math.max(60, expected * 0.4); }
async function metadata(url) {
  const delay = Math.max(0, nextMetadata - Date.now());
  nextMetadata = Math.max(Date.now(), nextMetadata) + 3000;
  await new Promise(resolve => setTimeout(resolve, delay));
  return JSON.parse(await run([...downloader, '--skip-download', '--dump-single-json', url]));
}
async function findSource(song, expected) {
  const prior = sources.find(source => source.songId === song.id);
  const previous = report.results.find(row => row.songId === song.id);
  const blockedUrl = previous?.status === 'full_recording_failed' && /403|Forbidden/.test(previous.error || '') ? prior?.url : null;
  const override = sourceOverrides.find(source => source.songId === song.id);
  const direct = override?.url || prior?.url || practice.find(source => source.songId === song.id)?.original.url;
  if (direct && direct !== blockedUrl && videoUrl(direct)) {
    try {
      const info = await metadata(direct);
      if (matchesTitle(song, info.title) && (!override || (info.channel_is_verified && matchesArtists(song, info))) && fullLength(info.duration, expected) && info.duration <= 900 && !info.is_live && !variant.test(info.title)) {
        return { info, url: direct, basis: override?.matchBasis || 'Previously curated direct original-song link' };
      }
    } catch (error) { sourceLookupErrors.set(song.id, String(error).slice(0, 500)); }
  }
  const delay = Math.max(0, nextSearch - Date.now());
  nextSearch = Math.max(Date.now(), nextSearch) + 2000;
  await new Promise(resolveDelay => setTimeout(resolveDelay, delay));
  const query = retry ? `ytsearch12:${song.title} ${song.artist} official audio`
    : `ytsearch6:${song.title} ${song.artist} ${song.album || ''} official audio`;
  const search = JSON.parse(await run([...downloader, '--flat-playlist', '--dump-single-json', query]));
  const candidates = (search.entries || []).filter(entry => entry.url !== blockedUrl && entry.channel_is_verified && videoUrl(entry.url)
    && matchesTitle(song, entry.title) && !variant.test(entry.title) && fullLength(entry.duration, expected) && entry.duration <= 900);
  candidates.sort((a, b) => Number(/audio|lyric/i.test(b.title)) - Number(/audio|lyric/i.test(a.title)));
  for (const candidate of candidates.slice(0, 3)) {
    try {
      const info = await metadata(candidate.url);
      if (info.channel_is_verified && matchesTitle(song, info.title) && matchesArtists(song, info)
        && !variant.test(info.title) && !info.is_live && fullLength(info.duration, expected) && info.duration <= 900) {
        return { info, url: candidate.url, basis: 'Verified uploader; song title and all credited artists matched in metadata' };
      }
    } catch (error) { sourceLookupErrors.set(song.id, String(error).slice(0, 500)); }
  }
  return null;
}
function checkpoint(row) {
  report.results = [...report.results.filter(previous => previous.songId !== row.songId), row];
  report.generatedAt = new Date().toISOString();
  report.totalCatalogSongs = catalog.length;
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  if (!neural) writeFileSync('data/full-song-sources.json', JSON.stringify(sources, null, 2) + '\n');
  const statuses = report.results.reduce((counts, result) => { counts[result.status] = (counts[result.status] || 0) + 1; return counts; }, {});
  console.log(JSON.stringify({ checked: report.results.length, total: catalog.length, title: row.title, status: row.status, factors: row.observedFactorProxies, statuses }));
}
async function processSong(song) {
  if (!/^mb:[a-f0-9-]{36}$/.test(song.id)) throw new Error('Invalid catalog identity.');
  const path = resolve(inputRoot, `${song.id.slice(3)}.audio`);
  if (!path.startsWith(inputRoot + sep)) throw new Error('Audio path is outside the analysis workspace.');
  for (const suffix of ['', '.part', '.ytdl']) if (existsSync(path + suffix)) unlinkSync(path + suffix);
  let row = { songId: song.id, title: song.title, artist: song.artist, scope: 'full_recording', analyzedAt: new Date().toISOString() };
  try {
    let expected = await recordingSeconds(song);
    if (!expected) { checkpoint({ ...row, status: 'canonical_duration_unavailable' }); return; }
    let durationReference = lengths.find(entry => entry.songId === song.id);
    let match = await findSource(song, expected);
    if (!match && retry) {
      const alternate = await appleDuration(song);
      if (alternate.seconds && Math.abs(alternate.seconds - expected) > 3) {
        const alternateMatch = await findSource(song, alternate.seconds);
        if (alternateMatch) { match = alternateMatch; expected = alternate.seconds; durationReference = alternate; }
      }
    }
    if (!match) {
      const error = sourceLookupErrors.get(song.id);
      checkpoint({ ...row, status: error ? 'source_lookup_failed' : 'no_conservative_full_match', ...(error ? { error } : {}) });
      return;
    }
    const source = { songId: song.id, url: match.url, channel: match.info.channel,
      channelId: match.info.channel_id, titleIncludes: [song.title], matchedTitle: match.info.title,
      durationSeconds: match.info.duration, expectedSongSeconds: expected, durationReferenceUrl: durationReference?.sourceUrl,
      durationReferenceBasis: durationReference?.referenceBasis || 'MusicBrainz recording or release track',
      matchBasis: match.basis, recordingVersion: 'Canonical recording equivalence unverified' };
    const index = sources.findIndex(source => source.songId === song.id);
    if (index >= 0) sources[index] = source; else sources.push(source);
    try { await run([...downloader, '--max-filesize', '50M', '-f', 'bestaudio[ext=m4a]', '-o', path, match.url]); }
    catch { await run([...downloader, '--max-filesize', '50M', '-f', 'bestaudio[ext=webm]', '-o', path, match.url]); }
    const result = JSON.parse(await run(['scripts/analyze-preview.py', '--full-recording', ...(complete ? ['--complete-estimates'] : []), ...(neural ? ['--neural-vocals'] : []), '--file', path]));
    const decodedSeconds = result.evidence?.durationSeconds ?? result.durationSeconds;
    if (typeof decodedSeconds !== 'number' || Math.abs(decodedSeconds - match.info.duration) > 3) throw new Error(`Decoded duration ${decodedSeconds}s does not match the ${match.info.duration}s upload.`);
    row = { ...row, ...result, analyzedAt: new Date().toISOString(),
      source: { storeUrl: match.url, title: match.info.title, artist: match.info.channel, matchBasis: match.basis, expectedSongSeconds: expected,
        durationReferenceUrl: source.durationReferenceUrl, durationReferenceBasis: source.durationReferenceBasis }, durationValidated: true };
  } catch (error) { row = { ...row, status: 'full_recording_failed', error: String(error).slice(0, 500) }; }
  finally { for (const suffix of ['', '.part', '.ytdl']) if (existsSync(path + suffix)) unlinkSync(path + suffix); }
  checkpoint(row);
}
const pending = catalog.filter(song => {
  if (selected && !selected.has(song.id)) return false;
  const prior = report.results.find(row => row.songId === song.id);
  const legacy = prior && ['partial_excerpt_only', 'insufficient_pitch_evidence', 'insufficient_audio'].includes(prior.status) && !prior.durationValidated;
  return force || !prior || legacy || prior.status === 'full_recording_failed' || (retry && !['partial_excerpt_only', 'complete_audio_estimate'].includes(prior.status));
});
const running = new Set();
for (const song of pending) {
  const task = processSong(song).finally(() => running.delete(task));
  running.add(task);
  if (running.size >= concurrency) await Promise.race(running);
}
await Promise.all(running);
