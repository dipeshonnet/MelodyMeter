import { starterSongs } from '../data/starter';
import launchCatalog from '../data/launch-catalog.json';
import { admin, base } from './admin';
if (!process.argv.includes('--local') || !['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('The provisional starter catalog is for local development only. Use the canonical launch catalog for production.');
const songs = launchCatalog.length ? launchCatalog : starterSongs;
for (const song of songs) await admin('import', { song });
console.log(`Seeded ${songs.length} local catalog entries. Existing ratings and votes were preserved.`);
