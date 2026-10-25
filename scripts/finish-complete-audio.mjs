// Finite continuation of the user-authorized catalog analysis and publication.
// Existing analysis processes must finish before their reports are resumed.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
const python = process.env.MELODYMETER_AUDIO_PYTHON;
if (!python) throw new Error('Set MELODYMETER_AUDIO_PYTHON.');
mkdirSync('artifacts', { recursive: true });
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const catalog = read('data/launch-catalog.json');
const statusPath = 'artifacts/complete-audio-workflow.json';
const previous = existsSync(statusPath) ? read(statusPath) : {};
const remainingOnly = process.argv.includes('--remaining');
const initiallyComplete = new Set(read('data/full-audio-estimates.json').map(row => row.songId));
const initialRemaining = catalog.filter(song => !initiallyComplete.has(song.id));
const state = { ...previous, status: 'running', startedAt: new Date().toISOString(), stage: 'waiting_for_existing_batches',
  initialCompleteCount: initiallyComplete.size, requestedCount: remainingOnly ? initialRemaining.length : catalog.length };
delete state.finishedAt;
let finished = false, publishingError = null;
let publishedHash = previous.publishedHash || createHash('sha256').update(readFileSync('data/full-audio-estimates.json')).digest('hex');
let publishedCount = previous.publishedCount ?? read('data/full-audio-estimates.json').length;
let lastPublishedAt = previous.publishedAt ? Date.parse(previous.publishedAt) : Date.now();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function save(update = {}) {
  Object.assign(state, update, { updatedAt: new Date().toISOString() });
  writeFileSync(statusPath, JSON.stringify(state, null, 2) + '\n');
}
function run(script, args = [], env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { windowsHide: true, env: { ...process.env, ...env } });
    let output = '';
    child.stdout.on('data', data => { output = (output + data).slice(-6000); });
    child.stderr.on('data', data => { output = (output + data).slice(-6000); });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(`${script} exited ${code}: ${output.slice(-1800)}`)));
  });
}
const reportRows = path => existsSync(path) ? read(path).results : [];
async function publish(force = false) {
  await run('scripts/run.mjs', ['tsx', 'scripts/import-complete-audio.ts']);
  await run('scripts/report-complete-audio.mjs');
  const contents = readFileSync('data/full-audio-estimates.json');
  const hash = createHash('sha256').update(contents).digest('hex'), count = JSON.parse(contents).length;
  save({ supportedCount: count });
  if (hash === publishedHash || (!force && count - publishedCount < 5 && Date.now() - lastPublishedAt < 600000)) return;
  save({ publication: 'building' });
  await run('scripts/run.mjs', ['astro', 'check']);
  await run('scripts/run.mjs', ['typescript', '-p', 'tsconfig.worker.json', '--noEmit']);
  await run('scripts/run.mjs', ['astro', 'build']);
  // Import is not run again until both applications and their exact snapshot are verified.
  save({ publication: 'deploying' });
  await run('scripts/run.mjs', ['wrangler', 'deploy', '--config', 'worker/wrangler.jsonc']);
  const deployment = await run('scripts/run.mjs', ['wrangler', 'pages', 'deploy', 'dist', '--project-name', 'melodymeter', '--branch', 'main', '--commit-dirty=true']);
  await run('scripts/verify-published-audio.mjs');
  publishedHash = hash; publishedCount = count; lastPublishedAt = Date.now();
  save({ publication: 'verified', publishedCount, publishedHash, publishedAt: new Date().toISOString(),
    deploymentUrl: deployment.match(/https:\/\/[\w-]+\.melodymeter\.pages\.dev/)?.[0] });
  console.log(JSON.stringify({ published: count, stage: state.stage }));
}
async function publisher() {
  while (!finished) {
    try { await publish(); publishingError = null; }
    catch (error) { publishingError = String(error); save({ publication: 'failed', publicationError: publishingError }); console.error(publishingError); }
    await delay(30000);
  }
}
async function waitForExisting() {
  const pids = (process.env.MELODYMETER_WAIT_PIDS || '').split(',').filter(Boolean).map(Number);
  if (pids.some(pid => !Number.isInteger(pid) || pid <= 0)) throw new Error('Invalid process identity.');
  while (pids.some(pid => { try { process.kill(pid, 0); return true; } catch { return false; } })) await delay(30000);
}
const publishedIds = () => new Set(read('data/full-audio-estimates.json').map(row => row.songId));
const pendingNeural = () => {
  const available = publishedIds(), attempted = new Set(reportRows('artifacts/neural-complete-audio-analysis.json').map(row => row.songId));
  return catalog.filter(song => !available.has(song.id) && !attempted.has(song.id));
};
async function analyzeRemaining() {
  const initialIds = initialRemaining.map(song => song.id).join(',');
  if (!initialIds) return;
  save({ stage: 'remaining_monochrome_foreground' });
  await run('scripts/analyze-streaming-catalog.mjs', ['--all', '--force'],
    { MELODYMETER_AUDIO_SONGS: initialIds, MELODYMETER_AUDIO_CONCURRENCY: '2' });
  const supported = new Set([...publishedIds(), ...reportRows('artifacts/streaming-audio-analysis.json')
    .filter(row => row.status === 'complete_audio_estimate').map(row => row.songId)]);
  const streamingPending = reportRows('artifacts/streaming-audio-analysis.json')
    .filter(row => !supported.has(row.songId) && row.durationValidated).map(row => row.songId);
  if (streamingPending.length) {
    save({ stage: 'remaining_monochrome_neural', neuralStreamingCount: streamingPending.length });
    await run('scripts/analyze-streaming-catalog.mjs', ['--all', '--neural-vocals', '--retry-unavailable'],
      { MELODYMETER_AUDIO_SONGS: streamingPending.join(','), MELODYMETER_AUDIO_CONCURRENCY: '2', MELODYMETER_VOCAL_THREADS: '2' });
  }
  const complete = new Set([...supported, ...reportRows('artifacts/neural-streaming-audio-analysis.json')
    .filter(row => row.status === 'complete_audio_estimate').map(row => row.songId)]);
  // Revisit YouTube lookups that never supplied audio. Previously analyzed neural
  // recordings with insufficient evidence have already had the Monochrome alternative.
  const priorNeural = new Map(reportRows('artifacts/neural-complete-audio-analysis.json').map(row => [row.songId, row]));
  const youtubePending = initialRemaining.filter(song => !complete.has(song.id) && !priorNeural.get(song.id)?.durationValidated);
  if (youtubePending.length) {
    save({ stage: 'remaining_youtube_neural', neuralPendingCount: youtubePending.length });
    await run('scripts/analyze-youtube-catalog.mjs', ['--complete-estimates', '--neural-vocals', '--retry-unavailable'],
      { MELODYMETER_AUDIO_SONGS: youtubePending.map(song => song.id).join(','), MELODYMETER_AUDIO_CONCURRENCY: '2', MELODYMETER_VOCAL_THREADS: '2' });
  }
}
save();
const publicationTask = publisher();
try {
  await waitForExisting();
  if (remainingOnly) {
    await analyzeRemaining();
  } else {
  save({ stage: 'retrying_youtube_sources' });
  await run('scripts/analyze-youtube-catalog.mjs', ['--complete-estimates', '--retry-unavailable'], { MELODYMETER_AUDIO_SONGS: '', MELODYMETER_AUDIO_CONCURRENCY: '3' });
  save({ stage: 'retrying_streaming_sources' });
  await run('scripts/analyze-streaming-catalog.mjs', ['--retry-unavailable'], { MELODYMETER_AUDIO_SONGS: '' });
  // Reports are read directly as well as published data, so an import interval cannot create duplicate work.
  const supported = new Set(['artifacts/complete-audio-analysis.json', 'artifacts/streaming-audio-analysis.json', 'artifacts/neural-complete-audio-analysis.json']
    .flatMap(path => reportRows(path).filter(row => row.status === 'complete_audio_estimate').map(row => row.songId)));
  const pending = pendingNeural().filter(song => !supported.has(song.id));
  if (pending.length) {
    save({ stage: 'neural_youtube_fallback', neuralPendingCount: pending.length });
    await run('scripts/analyze-youtube-catalog.mjs', ['--complete-estimates', '--neural-vocals', '--retry-unavailable'],
      { MELODYMETER_AUDIO_SONGS: pending.map(song => song.id).join(','), MELODYMETER_AUDIO_CONCURRENCY: '2', MELODYMETER_VOCAL_THREADS: '2' });
  }
  const fullIds = new Set([...publishedIds(), ...reportRows('artifacts/neural-complete-audio-analysis.json').filter(row => row.status === 'complete_audio_estimate').map(row => row.songId)]);
  const streamIds = reportRows('artifacts/streaming-audio-analysis.json').filter(row => !fullIds.has(row.songId) && row.durationValidated).map(row => row.songId);
  if (streamIds.length) {
    save({ stage: 'neural_streaming_fallback', neuralStreamingCount: streamIds.length });
    await run('scripts/analyze-streaming-catalog.mjs', ['--neural-vocals', '--all'], { MELODYMETER_AUDIO_SONGS: streamIds.join(','), MELODYMETER_VOCAL_THREADS: '2' });
  }
  }
  finished = true;
  await publicationTask;
  save({ stage: 'final_publication' });
  await publish(true);
  const coverage = read('artifacts/complete-audio-summary.json');
  save({ status: 'complete', stage: 'complete', finishedAt: new Date().toISOString(),
    completeCount: coverage.complete, newCompleteCount: coverage.complete - initiallyComplete.size,
    incompleteCount: coverage.incomplete, awaitingCount: coverage.awaiting, publicationError: null });
  console.log(JSON.stringify({ status: 'complete', complete: coverage.complete, incomplete: coverage.incomplete, awaiting: coverage.awaiting }));
} catch (error) {
  finished = true;
  await publicationTask;
  save({ status: 'failed', error: String(error), publicationError: publishingError });
  console.error(String(error));
  process.exitCode = 1;
}
