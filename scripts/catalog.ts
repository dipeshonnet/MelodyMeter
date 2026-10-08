import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { z } from 'zod';
import { admin } from './admin';
import { MODEL } from '../worker/src/ai';
import type { Song } from '../shared/rating';

const [command, file] = process.argv.slice(2);
const candidate = z.object({ musicbrainzId: z.string().uuid(), language: z.enum(['Hindi', 'English']), title: z.string().min(1).max(200), artist: z.string().min(1).max(200), version: z.string().min(1).max(200).default('Original studio lead melody'), aliases: z.array(z.string().max(200)).max(20).default([]), album: z.string().max(200).default(''), year: z.number().int().min(1900).max(2100).optional() }).strict();
type Catalog = { songs: Song[]; jobs: { status: string; count: number }[] };
function counts(songs: Song[]) { return { total: songs.length, Hindi: songs.filter(s => s.language === 'Hindi').length, English: songs.filter(s => s.language === 'English').length }; }
if (command === 'import') {
  if (!file) throw new Error('Usage: pnpm catalog:import data/imports/candidates.json');
  const entries = z.array(candidate).min(1).max(1000).parse(JSON.parse(readFileSync(file, 'utf8')));
  if (new Set(entries.map(e => e.musicbrainzId.toLowerCase())).size !== entries.length) throw new Error('Each recording identity must appear once.');
  for (const entry of entries) {
    const musicbrainzId = entry.musicbrainzId.toLowerCase();
    // Resolve the explicitly selected recording; do not guess versions from the first search hit.
    await admin('resolve', { songId: `mb:${musicbrainzId}` });
    const song: Song = { ...entry, musicbrainzId, id: `mb:${musicbrainzId}`, slug: `recording-${musicbrainzId}`, color: entry.language === 'Hindi' ? 'amber' : 'teal', referenceUrl: `https://musicbrainz.org/recording/${musicbrainzId}` };
    await admin('import', { song });
    // Core metadata API calls share a database throttle with online search.
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
  console.log(`Imported ${entries.length} canonical recordings. Resume safely by rerunning the same file.`);
} else if (command === 'enqueue') {
  const { songs } = await admin<Catalog>('catalog');
  const pending = songs.filter(s => s.musicbrainzId && !s.ai);
  for (const song of pending) await admin('enqueue', { songId: song.id });
  console.log(`${pending.length} generation jobs requested. Repeated requests share one saved job; the scheduler respects daily limits.`);
} else if (command === 'status') {
  const catalog = await admin<Catalog>('catalog');
  console.log(JSON.stringify({ recordings: counts(catalog.songs.filter(s => s.musicbrainzId)), savedModelEstimates: counts(catalog.songs.filter(s => s.musicbrainzId && s.ai?.model === MODEL)), jobs: catalog.jobs, launchTarget: { Hindi: 500, English: 500 } }, null, 2));
} else if (command === 'export') {
  const { songs } = await admin<Catalog>('catalog');
  const rated = songs.filter(s => s.musicbrainzId && s.ai?.model === MODEL);
  const total = counts(rated);
  if (process.argv.includes('--require-launch-target') && (total.Hindi < 500 || total.English < 500)) throw new Error(`Launch is incomplete: ${total.Hindi}/500 Hindi and ${total.English}/500 English usable model estimates.`);
  const selected = ['Hindi', 'English'].flatMap(language => songs.filter(s => s.musicbrainzId && s.language === language));
  mkdirSync('data', { recursive: true });
  writeFileSync('data/launch-catalog.json', JSON.stringify(selected, null, 2) + '\n');
  console.log(`Exported ${selected.length} recordings, including ${rated.length} saved estimates. Run pnpm build to pre-render their pages.`);
} else throw new Error('Choose import, enqueue, status, or export. See README.md for the launch workflow.');
