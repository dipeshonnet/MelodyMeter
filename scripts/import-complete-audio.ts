import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fullAudioSchema, overallScore, type Song } from '../shared/rating';
const catalog: Song[] = JSON.parse(readFileSync('data/launch-catalog.json', 'utf8'));
const existing = JSON.parse(readFileSync('data/full-audio-estimates.json', 'utf8'));
const entries = new Map(existing.map((entry: any) => [entry.songId, entry]));
const normalize = (value: string) => value.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '');
const aliases = JSON.parse(readFileSync('data/audio-title-aliases.json', 'utf8'));
let count = 0;
for (const path of ['artifacts/complete-audio-analysis.json', 'artifacts/manual-streaming-audio-analysis.json', 'artifacts/streaming-audio-analysis.json', 'artifacts/neural-complete-audio-analysis.json', 'artifacts/neural-streaming-audio-analysis.json']) {
  if (!existsSync(path)) continue;
  const report = JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
  for (const row of report.results) {
    if (row.status !== 'complete_audio_estimate') continue;
    const song = catalog.find(song => song.id === row.songId);
    if (!song || !row.durationValidated || !row.source?.matchBasis) throw new Error('Unverified recording identity or duration.');
    const excluded = [song.album, song.artist, ...song.artist.split(/,|&/)].map(normalize);
    const titles = [song.title.replace(/\s*\((?:male|female|original).*?\)/ig, ''), song.title, ...song.aliases.filter(alias => !excluded.includes(normalize(alias))), ...(aliases.find((entry: any) => entry.songId === song.id)?.titles || [])];
    if (!titles.some(title => normalize(title).length >= 4 && normalize(row.source.title).includes(normalize(title)))) throw new Error(`Song title mismatch: ${song.title}`);
    const e = row.evidence;
    if (!e || e.pitchEventCount < 20 || e.phraseCount < 5 || e.supportedBlockCount < 3 || e.beatCount < 16 || e.foregroundEnergyFraction < .015) throw new Error(`Insufficient complete evidence: ${song.title}`);
    const assessment = fullAudioSchema.parse({ factors: row.observedFactorProxies, overall: overallScore(row.observedFactorProxies),
      reasons: row.reasons, confidence: row.confidence, method: e.separationModel ? 'mdx-pyin-nine-proxies-v1' : 'foreground-nine-proxies-v1', scope: 'full_recording',
      generatedAt: row.analyzedAt, clipSeconds: e.durationSeconds, confidentPitchSeconds: e.confidentPitchSeconds,
      trackingPitchSeconds: e.estimatePitchSeconds, trackingProbabilityThreshold: e.estimatePitchProbabilityThreshold,
      pitchResolutionSemitones: e.pitchResolutionSemitones || .1,
      sourceUrl: row.source.storeUrl, sourceTitle: row.source.title, sourceArtist: row.source.artist,
      limitations: row.limitations, measurements: e.proxyMeasurements });
    const previous = (entries.get(song.id) as any)?.assessment;
    // Prefer vocal separation over mix foreground proxies, then newest of the same method.
    if (previous?.method === 'mdx-pyin-nine-proxies-v1' && assessment.method !== previous.method) continue;
    if (previous?.method === assessment.method && previous.generatedAt > assessment.generatedAt) continue;
    entries.set(song.id, { songId: song.id, assessment }); count++;
  }
}
writeFileSync('data/full-audio-estimates.json', JSON.stringify([...entries.values()], null, 2) + '\n');
console.log(`Imported ${count} supported complete estimates; ${entries.size} total. All factors explicitly low confidence.`);
