import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const catalog = read('data/launch-catalog.json');
const complete = new Map(read('data/full-audio-estimates.json').map(row => [row.songId, row.assessment]));
const partial = new Map(read('data/audio-assessments.json').map(row => [row.songId, row.assessment]));
const paths = ['artifacts/complete-audio-analysis.json', 'artifacts/streaming-audio-analysis.json', 'artifacts/neural-complete-audio-analysis.json', 'artifacts/neural-streaming-audio-analysis.json'];
const reports = paths.filter(existsSync).map(path => ({ path, report: read(path) }));
const rows = catalog.map(song => {
  const full = complete.get(song.id), old = partial.get(song.id);
  const attempts = reports.flatMap(({ path, report }) => report.results.filter(row => row.songId === song.id).map(row => ({ report: path, status: row.status, error: row.error })));
  return { songId: song.id, title: song.title, artist: song.artist,
    status: full ? 'complete_low_confidence_estimate' : attempts.length ? 'incomplete_after_attempt' : 'awaiting_complete_analysis',
    overall: full?.overall, factors: full?.factors, method: full?.method, sourceUrl: full?.sourceUrl,
    durationSeconds: full?.clipSeconds, trackedSeconds: full?.trackingPitchSeconds,
    confidentSeconds: full?.confidentPitchSeconds, retainedPartialFactors: old ? Object.keys(old.factors) : [], attempts };
});
const summary = { generatedAt: new Date().toISOString(), total: rows.length,
  complete: rows.filter(row => row.overall !== undefined).length,
  incomplete: rows.filter(row => row.status === 'incomplete_after_attempt').length,
  awaiting: rows.filter(row => row.status === 'awaiting_complete_analysis').length,
  retainedPartial: partial.size, allCompleteFactorsHaveLowConfidence: true,
  methods: rows.filter(row => row.method).reduce((counts, row) => ({ ...counts, [row.method]: (counts[row.method] || 0) + 1 }), {}), rows };
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/complete-audio-summary.json', JSON.stringify(summary, null, 2) + '\n');
const escape = value => String(value ?? '—').replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ');
writeFileSync('artifacts/complete-audio-summary.md', `# Full-recording automated score coverage\n\nGenerated ${summary.generatedAt}.\n\n${summary.complete} of ${summary.total} songs have complete nine-factor estimates; ${summary.incomplete} remain incomplete after an attempt; ${summary.awaiting} await this pass. ${summary.retainedPartial} previous partial assessments are retained.\n\nEvery complete estimate is low confidence and uses unvalidated acoustic proxy bands. Full audio duration does not prove canonical recording equivalence, identify the lead singer, or establish actual breaths, syllables or physiological effort.\n\n| Song | Artist | Status | Overall ease | Method | Source |\n| --- | --- | --- | --- | --- | --- |\n` + rows.map(row => `| ${escape(row.title)} | ${escape(row.artist)} | ${escape(row.status)} | ${escape(row.overall)} | ${escape(row.method)} | ${row.sourceUrl ? `[recording](${row.sourceUrl})` : '—'} |`).join('\n') + '\n');
console.log(JSON.stringify({ total: summary.total, complete: summary.complete, incomplete: summary.incomplete, awaiting: summary.awaiting, methods: summary.methods }));
