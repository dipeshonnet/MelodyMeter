import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const catalog = JSON.parse(readFileSync('data/launch-catalog.json', 'utf8'));
const ids = new Set();
const titles = new Set();
const problems = [];
for (const song of catalog) {
  if (!/^[0-9a-f-]{36}$/.test(song.musicbrainzId || '') || song.id !== `mb:${song.musicbrainzId}` || song.slug !== `recording-${song.musicbrainzId}`) problems.push(`Invalid recording identity: ${song.title}`);
  if (ids.has(song.id)) problems.push(`Duplicate identity: ${song.title}`);
  ids.add(song.id);
  const titleKey = `${song.language}:${song.title.toLowerCase().replace(/[^a-z0-9]/g, '')}`;
  if (titles.has(titleKey)) problems.push(`Duplicate song title in language: ${song.title}`);
  titles.add(titleKey);
  if (!Number.isInteger(song.year) || song.year < 1950 || song.year > new Date().getFullYear()) problems.push(`Invalid original year: ${song.title}`);
  if (process.argv.includes('--built')) {
    const html = readFileSync(`dist/songs/${song.slug}/index.html`, 'utf8');
    if (!html.includes('id="song-detail"') || !html.includes(`data-song-id="${song.id}"`)) problems.push(`Missing song page: ${song.title}`);
  }
}
const census = Array.from({ length: 8 }, (_, i) => 1950 + i * 10).map(decade => ({ decade: `${decade}s`, Hindi: catalog.filter(s => s.language === 'Hindi' && Math.floor(s.year / 10) * 10 === decade).length, English: catalog.filter(s => s.language === 'English' && Math.floor(s.year / 10) * 10 === decade).length }));
for (const row of census) for (const language of ['Hindi', 'English']) if (row[language] < 20) problems.push(`${row.decade} ${language}: ${row[language]}/20`);
const result = { checkedAt: new Date().toISOString(), total: catalog.length, savedAI: catalog.filter(s => s.ai).length, awaitingAssessment: catalog.filter(s => !s.ai).length, census, problems };
mkdirSync('artifacts', { recursive: true });
writeFileSync('artifacts/decade-check.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
if (problems.length) process.exitCode = 1;
