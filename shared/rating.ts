import { z } from 'zod';

export const FACTORS = [
  { id: 'pace', label: 'Singing speed', short: 'Speed', description: 'How quickly you sing the words and main notes.', weight: 15, icon: '◷' },
  { id: 'range', label: 'Pitch range', short: 'Range', description: 'How far the melody stretches from low to high.', weight: 20, icon: '↕' },
  { id: 'jumps', label: 'Note jumps', short: 'Jumps', description: 'Sudden jumps between distant notes.', weight: 15, icon: '⌁' },
  { id: 'sustain', label: 'Held notes', short: 'Held notes', description: 'Holding notes steadily without losing control.', weight: 10, icon: '―' },
  { id: 'breath', label: 'Breathing room', short: 'Breathing', description: 'Enough chances to breathe between phrases.', weight: 10, icon: '≈' },
  { id: 'rhythm', label: 'Rhythm and timing', short: 'Timing', description: 'Tricky entrances, accents, and off-beat phrases.', weight: 10, icon: '♩' },
  { id: 'runs', label: 'Vocal runs', short: 'Runs', description: 'Several quick notes on a single syllable.', weight: 10, icon: '∿' },
  { id: 'stamina', label: 'Stamina', short: 'Stamina', description: 'The effort needed to finish the vocal part.', weight: 5, icon: '◇' },
  { id: 'changes', label: 'Section changes', short: 'Changes', description: 'Changes in pace, feel, and melodic pattern.', weight: 5, icon: '⇄' },
] as const;
export type FactorId = typeof FACTORS[number]['id'];
export type FactorScores = Record<FactorId, number>;
export const FACTOR_IDS = FACTORS.map(f => f.id);
export const QUALIFICATION_COUNT = 10;
export const RUBRIC_VERSION = 'comfortable-melody-v3';
const ease = z.number().int().min(1).max(10);
const scoreShape = Object.fromEntries(FACTOR_IDS.map(id => [id, ease])) as Record<FactorId, typeof ease>;
export const factorScoresSchema = z.object(scoreShape).strict();
export const voteSchema = z.object({
  overall: ease,
  factors: z.record(z.enum(FACTOR_IDS as [FactorId, ...FactorId[]]), ease).default({}),
}).strict();
export type VoteInput = z.infer<typeof voteSchema>;
export const aiOutputSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('insufficient_information'), explanation: z.string().min(10).max(500) }).strict(),
  z.object({
    status: z.literal('rated'),
    factors: factorScoresSchema,
    reasons: z.object(Object.fromEntries(FACTOR_IDS.map(id => [id, z.string().min(10).max(220)])) as Record<FactorId, z.ZodString>).strict(),
    explanation: z.string().min(20).max(600),
    tip: z.string().min(10).max(300),
    sourceIds: z.array(z.string()).max(10).default([]),
  }).strict(),
]);
export type AIOutput = Extract<z.infer<typeof aiOutputSchema>, { status: 'rated' }>;
export interface AIRating extends AIOutput { overall: number; model: string; generatedAt: string; rubricVersion: string; }
export interface Song {
  id: string; slug: string; title: string; artist: string; language: 'Hindi' | 'English' | 'Other';
  album: string; year?: number; version: string; aliases: string[];
  musicbrainzId?: string; referenceUrl?: string; color: string;
  ai?: AIRating;
}
export interface AudienceMetric { count: number; score: number | null; qualified: boolean; }
export interface AudienceRating { overall: AudienceMetric; factors: Record<FactorId, AudienceMetric>; updatedAt?: string; }
export interface RatingResponse { song: Song; ai: AIRating | null; audience: AudienceRating; job?: { status: string; retryAt?: string; message?: string }; }

export function overallScore(scores: FactorScores): number {
  const validated = factorScoresSchema.parse(scores);
  return Math.round(FACTORS.reduce((total, f) => total + validated[f.id] * f.weight, 0) / 100);
}
export function easeLabel(score: number): string {
  return score >= 9 ? 'Very easy' : score >= 7 ? 'Easy' : score >= 5 ? 'Medium' : score >= 3 ? 'Hard' : 'Very hard';
}
export function overallLabel(score: number): string {
  return score >= 9 ? 'Very easy' : score >= 7 ? 'Easy' : score >= 5 ? 'Moderate' : score >= 3 ? 'Challenging' : 'Very challenging';
}
export function emptyAudience(): AudienceRating {
  return { overall: metric(0, null), factors: Object.fromEntries(FACTOR_IDS.map(id => [id, metric(0, null)])) as Record<FactorId, AudienceMetric> };
}
export function metric(count: number, average: number | null): AudienceMetric {
  return { count, score: count >= QUALIFICATION_COUNT && average !== null ? Math.round(average * 10) / 10 : null, qualified: count >= QUALIFICATION_COUNT };
}
export function audienceFromPayload(raw: string | null): AudienceRating {
  if (!raw) return emptyAudience();
  const parsed = JSON.parse(raw) as { count: number; overall: number | null; factors: Record<FactorId, { count: number; score: number | null }> };
  return { overall: metric(parsed.count, parsed.overall), factors: Object.fromEntries(FACTOR_IDS.map(id => [id, metric(parsed.factors[id]?.count || 0, parsed.factors[id]?.score ?? null)])) as AudienceRating['factors'] };
}
export function primaryScore(ai: AIRating | null | undefined, audience: AudienceRating): { score: number | null; source: 'community' | 'ai' | 'pending' } {
  if (audience.overall.qualified) return { score: audience.overall.score, source: 'community' };
  return { score: ai?.overall ?? null, source: ai ? 'ai' : 'pending' };
}
export function searchTerms(query: string): string[] {
  return query.toLocaleLowerCase().normalize('NFKD').split(/\s+/).filter(Boolean);
}
export function songSearchText(song: Song): string {
  return [song.title, song.artist, song.album, ...song.aliases].join(' ').toLocaleLowerCase().normalize('NFKD');
}
export function searchSongs(songs: Song[], query: string): Song[] {
  const terms = searchTerms(query);
  return songs.filter(song => {
    const text = songSearchText(song);
    return terms.every(term => text.includes(term));
  });
}
