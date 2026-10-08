import { readFileSync, writeFileSync } from 'node:fs';
import { cloudflare, accountId } from './cloudflare.mjs';
const songs = JSON.parse(readFileSync('data/launch-catalog.json', 'utf8'));
const databaseId = '8896068d-2e1b-478b-ab30-bdc31153a7b5';
const endpoint = `/accounts/${accountId}/d1/database/${databaseId}/query`;
const query = async (sql, params = []) => {
  const result = await cloudflare(endpoint, 'POST', { sql, params });
  if (result.some(row => row.success === false)) throw new Error('Database import failed.');
  return result[0].results;
};
const snapshot = () => query('SELECT (SELECT COUNT(*) FROM ai_ratings) AS ratings,(SELECT COUNT(*) FROM votes) AS votes,(SELECT COUNT(*) FROM songs) AS songs');
const before = (await snapshot())[0];
writeFileSync('artifacts/catalog-before-expansion.json', JSON.stringify(await query('SELECT * FROM songs'), null, 2) + '\n');
console.log('Before import:', before);
const sql = `INSERT INTO songs(id,slug,title,artist,language,album,year,version,aliases_json,musicbrainz_id,reference_url,color,search_text)
  SELECT json_extract(value,'$.id'),json_extract(value,'$.slug'),json_extract(value,'$.title'),json_extract(value,'$.artist'),json_extract(value,'$.language'),json_extract(value,'$.album'),json_extract(value,'$.year'),json_extract(value,'$.version'),json_extract(value,'$.aliases_json'),json_extract(value,'$.musicbrainzId'),json_extract(value,'$.referenceUrl'),json_extract(value,'$.color'),json_extract(value,'$.search_text') FROM json_each(?) WHERE 1
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,artist=excluded.artist,language=excluded.language,album=excluded.album,year=excluded.year,version=excluded.version,aliases_json=excluded.aliases_json,search_text=excluded.search_text`;
for (let i = 0; i < songs.length; i += 20) {
  const batch = songs.slice(i, i + 20).map(song => ({ ...song, aliases_json: JSON.stringify(song.aliases), search_text: [song.title, song.artist, song.album, ...song.aliases].join(' ').normalize('NFKD').toLowerCase() }));
  await query(sql, [JSON.stringify(batch)]);
  console.log(`Imported ${Math.min(i + 20, songs.length)}/${songs.length} recording metadata`);
}
const after = (await snapshot())[0];
if (before.ratings !== after.ratings || before.votes !== after.votes) throw new Error('Assessment or vote counts changed unexpectedly.');
const census = await query("SELECT (year/10)*10 AS decade,language,COUNT(*) AS songs FROM songs WHERE language IN ('Hindi','English') GROUP BY decade,language ORDER BY decade,language");
console.log(JSON.stringify({ after, census, preservedAssessmentAndVoteCounts: true }, null, 2));
