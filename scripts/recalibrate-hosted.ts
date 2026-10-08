import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');
process.env.MELODYMETER_API = 'https://melody.everydayai.work';
process.env.MELODYMETER_ADMIN_SECRET = JSON.parse(readFileSync('deployment-secrets.local.json', 'utf8')).ADMIN_SECRET;
const { admin } = await import('./admin');
const command = process.argv[2];
const easy = JSON.parse(readFileSync('data/easy-recordings.json', 'utf8'));
const normalize = (s: string) => s.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
if (command === 'import') {
  for (const entry of easy) {
    const { song } = await admin<any>('resolve', { songId: `mb:${entry.musicbrainzId}` });
    if (normalize(song.title) !== normalize(entry.title) || normalize(song.artist) !== normalize(entry.artist)) throw new Error(`Recording identity mismatch: ${entry.title}`);
    song.language = entry.language;
    song.aliases = entry.title.includes('Hasi') ? ['Hasi', 'Hasi Ban Gaye'] : entry.title.includes('Sham') ? ['Yeh Shaam Mastani'] : [];
    await admin('import', { song });
    console.log(`Imported ${song.title}`);
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
} else if (command === 'preview') {
  mkdirSync('artifacts', { recursive: true });
  const rows = [];
  const ids = process.argv.slice(3);
  for (const songId of ids) {
    try {
      const { assessment } = await admin<any>('assessment-preview', { songId });
      rows.push({ songId, assessment });
      console.log(JSON.stringify({ songId, assessment }));
    } catch (error) { console.log(JSON.stringify({ songId, error: String(error) })); }
  }
  writeFileSync('artifacts/calibration-preview.json', JSON.stringify(rows, null, 2));
} else if (command === 'process') {
  for (let i = 0; i < Number(process.argv[3] || 30); i++) { await admin('process', {}); console.log(`Processed job ${i + 1}`); }
} else if (command === 'export') {
  const result = await admin<any>('catalog');
  writeFileSync('data/launch-catalog.json', JSON.stringify(result.songs, null, 2) + '\n');
  console.log(JSON.stringify({ total: result.songs.length, rated: result.songs.filter((s: any) => s.ai).length, easy: result.songs.filter((s: any) => s.ai?.overall >= 7).map((s: any) => ({ title: s.title, score: s.ai.overall })), jobs: result.jobs }));
} else if (command === 'queue') {
  const result = await admin<any>('catalog');
  for (const song of result.songs) {
    await admin('recalibrate', { songId: song.id });
    console.log(`Recalibration queued: ${song.title}`);
  }
} else throw new Error('Choose import, preview, queue, process, or export.');
