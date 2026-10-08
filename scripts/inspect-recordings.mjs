import './cloudflare.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const data = JSON.parse(readFileSync('data/imports/starter-candidates.local.json'));
console.log('Flowers', JSON.stringify(data.find(s => s.title === 'Flowers').choices));
const query = 'recording:"Bohemian Rhapsody" AND artist:Queen AND NOT comment:live';
const response = await fetch(`https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=100`, { headers: { 'User-Agent': 'MelodyMeter/0.1 (https://melody.everydayai.work)' } });
const result = await response.json();
writeFileSync('data/imports/queen.local.json', JSON.stringify(result));
console.log('Queen', JSON.stringify(result.recordings.filter(x => x.title === 'Bohemian Rhapsody' && !/live/i.test(x.disambiguation || '')).map(x => ({ id: x.id, version: x.disambiguation, releases: x.releases?.slice(0, 3).map(v => v.title) }))));
