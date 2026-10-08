import { readFileSync } from 'node:fs';
import { MODEL } from '../worker/src/ai';
import { aiOutputSchema, overallScore, type Song } from '../shared/rating';
const songs = JSON.parse(readFileSync('data/launch-catalog.json', 'utf8')) as Song[];
const problems: string[] = [];
for (const language of ['Hindi', 'English']) {
  const count = songs.filter(s => s.language === language).length;
  if (count !== 500) problems.push(`${language}: ${count}/500 launch recordings.`);
}
if (new Set(songs.map(s => s.id)).size !== songs.length) problems.push('Duplicate recording identities.');
for (const song of songs) {
  if (!song.musicbrainzId || song.id !== `mb:${song.musicbrainzId}` || !song.ai || song.ai.model !== MODEL) { problems.push(`Missing canonical identity or model result: ${song.title}`); continue; }
  const { overall, model, generatedAt, rubricVersion, ...output } = song.ai;
  if (!aiOutputSchema.safeParse(output).success || overall !== overallScore(song.ai.factors)) problems.push(`Invalid model rating: ${song.title}`);
}
const config = JSON.parse(readFileSync('worker/wrangler.jsonc', 'utf8'));
if (config.d1_databases[0].database_id === '00000000-0000-0000-0000-000000000000') problems.push('Production D1 database is not configured.');
if (config.vars.APP_ORIGIN !== 'https://melody.everydayai.work') problems.push('Production origin does not match the chosen domain.');
if (config.vars.DEV_MODE) problems.push('DEV_MODE must never be configured in production.');
if (problems.length) { console.error('Production launch is not ready:\n' + problems.map(p => `- ${p}`).join('\n')); process.exit(1); }
console.log('Catalog and configuration checks passed. Verify deployed Turnstile, email DNS, secrets, and Free plan limits before launch.');
