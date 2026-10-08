import { readFileSync, writeFileSync } from 'node:fs';
import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');
const catalog = JSON.parse(readFileSync('data/launch-catalog.json', 'utf8'));
const evidenceFile = JSON.parse(readFileSync('data/imports/decade-evidence.json', 'utf8'));
const cachePath = 'data/imports/decade-review.json';
let cache = {}; try { cache = JSON.parse(readFileSync(cachePath, 'utf8')); } catch {}
const normalize = value => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const grams = value => { value = normalize(value).replace(/aa/g,'a').replace(/ee/g,'i').replace(/oo/g,'u'); return new Set(Array.from({length: Math.max(0, value.length-1)},(_,i)=>value.slice(i,i+2))); };
const similar = (a,b) => { const x=grams(a),y=grams(b); return 2*[...x].filter(g=>y.has(g)).length/(x.size+y.size || 1); };
const excluded = /(?:\blive\b|karaoke|instrumental|tribute|demo|remix|\bmix\b|lofi|revival|unplugged|rehearsal|acoustic|cover|sped up|slowed|2\.0|3\.0|sad version|version 2|deewana mastana hua badal)/i;
const corrections = [];
let lastRequest = 0;
for (const evidence of evidenceFile.evidence) {
  const song = catalog.find(song => song.id === evidence.songId);
  if (!song || song.ai) continue; // Existing saved assessments always retain their identity.
  const decade = Math.floor(song.year / 10) * 10;
  if (!excluded.test(evidence.recordingTitle || '') && evidence.musicbrainzFirstRelease && Math.floor(Number(evidence.musicbrainzFirstRelease.slice(0,4))/10)*10 === decade) continue;
  const key = `${song.title}|${evidence.artist}|${decade}`;
  if (!cache[key]) {
    const quote = s => '"'+s.replace(/["\\]/g, ' ')+'"';
    const query = `recording:${quote(song.title)} AND artist:${quote(evidence.artist)} AND firstreleasedate:[${decade} TO ${decade+9}]`;
    for (let attempt=0; attempt<4; attempt++) {
      await new Promise(r=>setTimeout(r,Math.max(0,lastRequest+1400-Date.now()))); lastRequest=Date.now();
      try {
        const response = await fetch(`https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(query)}&fmt=json&limit=100`, {headers:{'User-Agent':'MelodyMeter/1.0 (https://melody.everydayai.work)'},signal:AbortSignal.timeout(20000)});
        if (!response.ok) throw new Error(`MusicBrainz ${response.status}`);
        cache[key]=await response.json(); writeFileSync(cachePath,JSON.stringify(cache,null,2)+'\n'); break;
      } catch(error) { if(attempt===3) throw error; await new Promise(r=>setTimeout(r,3000*(attempt+1))); }
    }
  }
  const rank = r => similar(r.title,song.title)*20 + (Number(r['first-release-date']?.slice(0,4))===song.year?12:0) + ((r.releases||[]).some(release=>similar(release.title,song.album)>.8)?6:0);
  const recordings = (cache[key].recordings || []).filter(r => !excluded.test(`${r.title} ${r.disambiguation || ''}`) && similar(r.title,song.title)>.72 && normalize((r['artist-credit']||[]).map(c=>`${c.name || ''} ${c.artist?.name || ''}`).join(' ')).includes(normalize(evidence.artist))).sort((a,b)=>rank(b)-rank(a));
  let chosen = recordings[0];
  if (!chosen && excluded.test(evidence.recordingTitle || '')) {
    const source = JSON.parse(readFileSync('data/imports/decade-metadata.json','utf8'));
    const broad = Object.entries(source).filter(([key])=>key.startsWith(`${song.title}|${evidence.artist}|`)).flatMap(([,response])=>response.recordings || []);
    chosen = broad.filter(r=>!excluded.test(`${r.title} ${r.disambiguation || ''}`) && similar(r.title,song.title)>.75).sort((a,b)=>rank(b)-rank(a))[0];
    if (!chosen) {
      const albumKey = `${song.title}|album:${song.album}`;
      if (!cache[albumKey]) {
        await new Promise(r=>setTimeout(r,Math.max(0,lastRequest+1400-Date.now()))); lastRequest=Date.now();
        const query=`recording:(${song.title.replace(/[^a-z0-9 ]/gi,' ')}) AND release:(${song.album.replace(/[^a-z0-9 ]/gi,' ')})`;
        const response=await fetch(`https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(query)}&fmt=json&limit=100`,{headers:{'User-Agent':'MelodyMeter/1.0 (https://melody.everydayai.work)'},signal:AbortSignal.timeout(20000)});
        if(!response.ok) throw new Error(`MusicBrainz ${response.status}`);
        cache[albumKey]=await response.json();writeFileSync(cachePath,JSON.stringify(cache,null,2)+'\n');
      }
      // Soundtrack recording credits sometimes name the composer instead of the vocalist.
      // In that case require the original film/album and retain the curated singer credit.
      chosen=(cache[albumKey].recordings||[]).filter(r=>!excluded.test(`${r.title} ${r.disambiguation || ''}`) && similar(r.title,song.title)>.7 && (r.releases||[]).some(release=>similar(release.title,song.album)>.75)).sort((a,b)=>rank(b)-rank(a))[0];
      if(chosen) chosen={...chosen,curatedSinger:true};
    }
    if (!chosen) throw new Error(`Original recording needs manual resolution: ${song.title}`);
  }
  if (!chosen) { console.log(`Retained identity, original year curated: ${song.title}`); continue; }
  const previous = song.id;
  song.musicbrainzId = chosen.id; song.id=`mb:${chosen.id}`; song.slug=`recording-${chosen.id}`; song.referenceUrl=`https://musicbrainz.org/recording/${chosen.id}`;
  song.artist=chosen.curatedSinger?evidence.artist:(chosen['artist-credit']||[]).map(c=>(c.name||c.artist?.name||'')+(c.joinphrase||'')).join('') || song.artist;
  song.aliases=[...new Set([...song.aliases, chosen.title])];
  Object.assign(evidence,{songId:song.id,recordingTitle:chosen.title,recordingArtist:chosen['artist-credit'],musicbrainzFirstRelease:chosen['first-release-date'],releases:chosen.releases,referenceUrl:song.referenceUrl});
  corrections.push({title:song.title,previous,selected:song.id,date:chosen['first-release-date']});
  console.log(`Reviewed ${song.title}: ${chosen.title} (${chosen['first-release-date']})`);
}
if (new Set(catalog.map(song=>song.id)).size !== catalog.length) throw new Error('Review created a duplicate recording.');
writeFileSync('data/launch-catalog.json',JSON.stringify(catalog,null,2)+'\n');
writeFileSync('data/imports/decade-evidence.json',JSON.stringify(evidenceFile,null,2)+'\n');
writeFileSync('artifacts/decade-identity-review.json',JSON.stringify(corrections,null,2)+'\n');
writeFileSync('data/decade-provenance.json',JSON.stringify(catalog.map(song => {
  const row=evidenceFile.evidence.find(e=>e.songId===song.id);
  return {songId:song.id,originalYear:song.year,album:song.album,referenceUrl:song.referenceUrl,musicbrainzFirstRelease:row?.musicbrainzFirstRelease,yearBasis:row?.yearBasis || 'Existing catalog; original song/film release year curated separately from compilation dates'};
}),null,2)+'\n');
console.log(`Reviewed ${corrections.length} recording identities; saved original-year provenance.`);
