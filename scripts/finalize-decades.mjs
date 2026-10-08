import { readFileSync, writeFileSync } from 'node:fs';
const catalog = JSON.parse(readFileSync('data/launch-catalog.json','utf8'));
const selections = JSON.parse(readFileSync('data/decade-selections.json','utf8'));
const evidence = JSON.parse(readFileSync('data/imports/decade-evidence.json','utf8'));
const normalize = value => value.toLowerCase().replace(/[^a-z0-9]/g,'');
const candidates = Object.values(selections).flatMap(languages => Object.entries(languages).flatMap(([language,songs])=>songs.map(([title,artist,year,album])=>({language,title,artist,year,album}))));
const kept = new Map();
for (const song of catalog) {
  const candidate = candidates.find(c=>c.language===song.language && normalize(c.title)===normalize(song.title));
  if (candidate) { song.year=candidate.year; song.album=candidate.album; }
  const key=`${song.language}:${normalize(song.title)}`;
  const previous=kept.get(key);
  if (!previous) kept.set(key,song);
  else {
    if (!previous.ai && !song.ai) throw new Error(`Two unresolved recordings: ${song.title}`);
    const winner=previous.ai?previous:song, removed=previous.ai?song:previous;
    winner.year=removed.year; winner.album=removed.album; winner.aliases=[...new Set([...winner.aliases,...removed.aliases])];
    kept.set(key,winner);
    for(const row of evidence.evidence) if(row.songId===removed.id) Object.assign(row,{songId:winner.id,referenceUrl:winner.referenceUrl,recordingTitle:winner.title,musicbrainzFirstRelease:undefined});
    console.log(`Preserved existing assessment identity: ${winner.title}`);
  }
}
const songs=[...kept.values()];
if(songs.filter(s=>s.ai).length!==27) throw new Error('Existing 27 assessments must remain intact.');
writeFileSync('data/launch-catalog.json',JSON.stringify(songs,null,2)+'\n');
writeFileSync('data/imports/decade-evidence.json',JSON.stringify(evidence,null,2)+'\n');
console.log(`Finalized ${songs.length} unique songs, preserving 27 assessments.`);
