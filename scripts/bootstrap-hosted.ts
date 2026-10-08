import { readFileSync, writeFileSync } from 'node:fs';
import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');
const secrets = JSON.parse(readFileSync('deployment-secrets.local.json', 'utf8'));
process.env.MELODYMETER_API = 'https://melody.everydayai.work';
process.env.MELODYMETER_ADMIN_SECRET = secrets.ADMIN_SECRET;
const { admin } = await import('./admin');
const data = JSON.parse(readFileSync('data/imports/starter-candidates.local.json', 'utf8'));
const selected: Record<string, string> = {
  'Bohemian Rhapsody': 'e53edec4-4e56-4543-8737-2a25be46ba2d',
  'Perfect': 'b84dd2d1-2bf1-4fcc-aadc-6cc39c36ba35',
  'Someone Like You': '028efe7f-cdfb-4135-846f-848f2fff15b1',
  'Shape of You': 'd7500dd6-b815-4299-88c6-3fbda358f1fc',
  'Tum Hi Ho': '3e5bc764-dfa4-454d-a2a9-0ee84ae35db2',
  'Kabira': 'fb43bc8c-99d0-42cd-b1d8-9293ec7bd377',
  'Channa Mereya': 'e27ee5d7-703d-4985-a183-e5eef0020fb5',
  'Pehla Nasha': '332a9bd7-e7b2-4fbe-a18a-fa956c7fc06b',
  'Ilahi': 'eb97a500-e1a5-4f07-bcbc-8bd510fb65cc',
  'Agar Tum Saath Ho': '4dd0f910-5739-4fa3-be84-a48d7b9b2753',
  'Raabta': 'a12467af-5c00-4fbf-8615-4dbab2cf8ea2',
  'Kesariya': '393ad701-a13d-4f1c-9e3f-65dfd7cac167',
  'Kal Ho Naa Ho': 'f2a2ffcc-4ca6-4534-b02a-6eb9befa1bb3',
  'Jeena Jeena': '2c79b42b-6c9a-4df7-a0ea-94f859bea3f3',
  'Kun Faya Kun': '2bba1a1d-39eb-4caf-aeac-33fa5baf4eb2'
};
if (process.argv.includes('--import')) {
  for (const [title, id] of Object.entries(selected)) {
    const metadata = data.find((s: any) => s.title === title);
    const { song } = await admin<any>('resolve', { songId: `mb:${id}` });
    if (song.title.toLowerCase() !== title.toLowerCase() || song.artist !== metadata.artist) throw new Error(`Recording mismatch: ${title}`);
    song.language = metadata.language;
    song.aliases = metadata.aliases;
    await admin('import', { song });
    await admin('enqueue', { songId: song.id });
    console.log(`Queued ${title}`);
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
} else if (process.argv.includes('--process')) {
  for (let i = 0; i < Object.keys(selected).length; i++) {
    await admin('process', {});
    console.log(`Generation pass ${i + 1}`);
  }
} else if (process.argv.includes('--export')) {
  const result = await admin<any>('catalog');
  const rated = result.songs.filter((s: any) => s.musicbrainzId && s.ai?.model === '@cf/meta/llama-3.1-8b-instruct-fp8-fast');
  if (!rated.length) throw new Error('No usable Workers AI estimates yet; do not publish provisional catalog as production.');
  const catalog = result.songs.filter((s: any) => s.musicbrainzId);
  writeFileSync('data/launch-catalog.json', JSON.stringify(catalog, null, 2) + '\n');
  console.log(JSON.stringify({ exported: catalog.length, savedEstimates: rated.length, jobs: result.jobs }));
} else {
  const result = await admin<any>('catalog');
  console.log(JSON.stringify({ songs: result.songs.map((s: any) => ({ title: s.title, language: s.language, rated: !!s.ai, score: s.ai?.overall })), jobs: result.jobs }));
}
