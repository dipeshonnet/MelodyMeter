import assessments from '../data/audio-assessments.json';
import fullAssessments from '../data/full-audio-estimates.json';
import { partialAudioSchema, fullAudioSchema, type PartialAudioRating, type FullAudioRating } from './rating';

const bySong = new Map<string, PartialAudioRating>();
for (const entry of assessments as { songId: string; assessment: unknown }[]) {
  if (bySong.has(entry.songId)) throw new Error('Duplicate partial audio assessment.');
  bySong.set(entry.songId, partialAudioSchema.parse(entry.assessment));
}
export function partialAudioFor(songId: string): PartialAudioRating | undefined {
  return bySong.get(songId);
}
const fullBySong = new Map<string, FullAudioRating>();
for (const entry of fullAssessments as { songId: string; assessment: unknown }[]) {
  if (fullBySong.has(entry.songId)) throw new Error('Duplicate complete audio estimate.');
  fullBySong.set(entry.songId, fullAudioSchema.parse(entry.assessment));
}
export function fullAudioFor(songId: string): FullAudioRating | undefined { return fullBySong.get(songId); }
