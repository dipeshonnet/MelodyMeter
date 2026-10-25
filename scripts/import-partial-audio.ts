import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { partialAudioSchema, type Song } from '../shared/rating';

const report = JSON.parse(readFileSync('artifacts/public-preview-analysis.json', 'utf8'));
const fullReport = existsSync('artifacts/full-song-analysis.json') ? JSON.parse(readFileSync('artifacts/full-song-analysis.json', 'utf8')) : { results: [] };
const catalog: Song[] = JSON.parse(readFileSync('data/launch-catalog.json', 'utf8'));
const saved = JSON.parse(readFileSync('data/audio-assessments.json', 'utf8'));
const titleAliases = JSON.parse(readFileSync('data/audio-title-aliases.json', 'utf8'));
const normalize = (value: string) => value.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '');
function matchesFullTitle(song: Song, upload: string) {
  const artists = song.artist.split(/,|&|\sfeat\.?\s|\sfeaturing\s/i).map(name => name.trim());
  const excluded = [song.artist, song.album, ...artists].filter(Boolean).map(normalize);
  const titles = [song.title.replace(/\s*\((?:male|female|original).*?\)/ig, ''),
    ...(titleAliases.find((entry: any) => entry.songId === song.id)?.titles || []),
    ...song.aliases.filter(alias => !excluded.includes(normalize(alias)))];
  return titles.some(title => normalize(title).length >= 4 && normalize(upload).includes(normalize(title)));
}
const entries = new Map(saved.map((entry: any) => [entry.songId, entry]));
let updated = 0;
for (const row of [...report.results, ...fullReport.results]) {
  if (row.status !== 'partial_excerpt_only' || !row.observedFactorProxies) continue;
  if (row.scope === 'full_recording' && !row.durationValidated) continue;
  const song = catalog.find(song => song.id === row.songId);
  if (!song || (song.ai && row.scope !== 'full_recording')) continue;
  if (row.scope === 'full_recording' && !matchesFullTitle(song, row.source?.title || '')) continue;
  const evidence = row.evidence;
  if (!evidence || evidence.confidentPitchSeconds < 2 || evidence.foregroundEnergyFraction < 0.015) throw new Error(`Insufficient evidence: ${row.title}`);
  const reasons: Record<string, string> = {};
  const full = row.scope === 'full_recording';
  if (!full && (entries.get(row.songId) as any)?.assessment.scope === 'full_recording') continue;
  for (const id of Object.keys(row.observedFactorProxies)) {
    if (id === 'range') reasons[id] = `Sampled foreground pitch span: ${evidence.pitchSpanP5P95Semitones} semitones, from ${evidence.confidentPitchSeconds} confident seconds of a ${evidence.durationSeconds}-second ${full ? 'full recording' : 'clip'}. Instruments or octave errors may affect this estimate.`;
    else if (id === 'sustain' && evidence.longestStablePitchSeconds >= 1.5) reasons[id] = `A stable foreground pitch lasted ${evidence.longestStablePitchSeconds} seconds in this ${full ? 'recording' : 'excerpt'}. The pitch is not verified as the lead voice.`;
    else throw new Error(`Unsupported partial factor: ${id}`);
  }
  const assessment = partialAudioSchema.parse({ factors: row.observedFactorProxies, reasons,
    generatedAt: row.analyzedAt || (entries.get(row.songId) as any)?.assessment.generatedAt || report.generatedAt, method: full ? 'foreground-pyin-full-v1' : 'foreground-pyin-partial-v2', scope: full ? 'full_recording' : 'preview',
    clipSeconds: evidence.durationSeconds, confidentPitchSeconds: evidence.confidentPitchSeconds,
    sourceUrl: row.source.storeUrl, sourceTitle: row.source.title, sourceArtist: row.source.artist });
  entries.set(row.songId, { songId: row.songId, assessment });
  updated++;
}
writeFileSync('data/audio-assessments.json', JSON.stringify([...entries.values()], null, 2) + '\n');
console.log(`Saved ${updated} partial audio assessments. No overall, AI, or audience scores changed.`);
