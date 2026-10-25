import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const catalog = JSON.parse(readFileSync('data/launch-catalog.json', 'utf8'));
const report = JSON.parse(readFileSync('artifacts/full-song-analysis.json', 'utf8'));
const scores = JSON.parse(readFileSync('data/audio-assessments.json', 'utf8'));
const aliases = JSON.parse(readFileSync('data/audio-title-aliases.json', 'utf8'));
const rows = new Map(report.results.map(row => [row.songId, row]));
const saved = new Map(scores.map(entry => [entry.songId, entry.assessment]));
assert.equal(rows.size, catalog.length, 'Every catalog song must have a result.');
assert.equal(report.results.length, rows.size, 'Duplicate analysis results.');
const normalize = value => value.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '');
for (const song of catalog) {
  const row = rows.get(song.id);
  assert.ok(row, `Missing result: ${song.title}`);
  if (row.status !== 'partial_excerpt_only') continue;
  assert.equal(row.durationValidated, true);
  const excluded = [song.artist, song.album, ...song.artist.split(/,|&|\sfeat\.?\s|\sfeaturing\s/i).map(name => name.trim())].filter(Boolean).map(normalize);
  const titles = [song.title.replace(/\s*\((?:male|female|original).*?\)/ig, ''), ...(aliases.find(entry => entry.songId === song.id)?.titles || []), ...song.aliases.filter(alias => !excluded.includes(normalize(alias)))];
  assert.ok(titles.some(title => normalize(title).length >= 4 && normalize(row.source.title).includes(normalize(title))), `Wrong recording title: ${song.title}`);
  const audio = saved.get(song.id);
  assert.ok(audio, `Missing published score: ${song.title}`);
  assert.equal(audio.scope, 'full_recording');
  assert.equal(audio.sourceUrl, row.source.storeUrl);
  assert.deepEqual(audio.factors, row.observedFactorProxies);
  assert.equal('overall' in audio, false);
}
const stats = {
  catalogSongs: catalog.length,
  analyzedFullRecordings: report.results.filter(row => row.durationValidated).length,
  fullRecordingScores: scores.filter(entry => entry.assessment.scope === 'full_recording').length,
  retainedPreviewScores: scores.filter(entry => entry.assessment.scope !== 'full_recording').length,
  statuses: report.results.reduce((counts, row) => { counts[row.status] = (counts[row.status] || 0) + 1; return counts; }, {}),
};
const labels = { partial_excerpt_only: 'Partial scores available', insufficient_pitch_evidence: 'Insufficient pitch evidence', no_conservative_full_match: 'No accepted full recording match', canonical_duration_unavailable: 'No duration reference', full_recording_failed: 'Recording analysis failed' };
const escape = value => String(value ?? '—').replaceAll('|', '\\|').replaceAll('\n', ' ');
const lines = ['# Full-song sound analysis', '',
  `Checked all ${stats.catalogSongs} catalog songs. Analyzed ${stats.analyzedFullRecordings} full YouTube recordings; saved ${stats.fullRecordingScores} provisional partial assessments. Retained ${stats.retainedPreviewScores} supported preview assessments.`, '',
  'Measurements cover sampled foreground pitch range and, where supported, sustain. They do not establish verified lead vocals or complete nine-factor singing ratings. Instruments, backing vocals and octave errors may affect estimates. Existing AI and audience scores are separate. No audio overall is computed.', '',
  `Generated: ${report.generatedAt}`, '',
  '| Song | Artist | Full-recording result | Audio seconds | Confident pitch seconds | Range ease | Sustain ease | Source |',
  '| --- | --- | --- | ---: | ---: | ---: | ---: | --- |'];
for (const song of catalog) {
  const row = rows.get(song.id);
  const link = row.source?.storeUrl ? `[YouTube](${row.source.storeUrl})` : '—';
  lines.push('| ' + [song.title, song.artist, labels[row.status] || row.status, row.evidence?.durationSeconds, row.evidence?.confidentPitchSeconds, row.observedFactorProxies?.range, row.observedFactorProxies?.sustain].map(escape).join(' | ') + ` | ${link} |`);
}
lines.push('', '## Retained preview assessments', '');
for (const entry of scores.filter(entry => entry.assessment.scope !== 'full_recording')) {
  const song = catalog.find(song => song.id === entry.songId);
  lines.push(`- ${song.title}: ${JSON.stringify(entry.assessment.factors)} from ${entry.assessment.clipSeconds} seconds. [Preview reference](${entry.assessment.sourceUrl}).`);
}
writeFileSync('artifacts/full-song-analysis-summary.md', lines.join('\n') + '\n');
writeFileSync('artifacts/full-song-analysis-summary.json', JSON.stringify(stats, null, 2) + '\n');
console.log(JSON.stringify(stats));
