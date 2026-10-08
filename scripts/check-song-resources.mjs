import { readFileSync, writeFileSync } from 'node:fs';
import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');
const catalog = JSON.parse(readFileSync('data/launch-catalog.json', 'utf8'));
const resources = JSON.parse(readFileSync('data/song-resources.json', 'utf8'));
const ids = new Set(resources.map(r => r.songId));
if (ids.size !== resources.length || resources.some(r => !catalog.some(s => s.id === r.songId))) throw new Error('Curated resources must use unique catalog recording identities.');
const links = resources.flatMap(r => ['lyrics', 'original', 'karaoke', 'video'].filter(k => r[k]).map(kind => ({ songId: r.songId, kind, ...r[kind] })));
for (const link of links) {
  const url = new URL(link.url);
  if (url.protocol !== 'https:' || url.username || url.password || !link.provider) throw new Error(`Invalid resource for ${link.songId}`);
  if (url.hostname === 'www.youtube.com' && (url.pathname !== '/watch' || !/^[\w-]{11}$/.test(url.searchParams.get('v') || ''))) throw new Error(`Invalid video identity: ${link.url}`);
}
console.log(`${resources.length} songs have curated direct practice links (${links.length} total); ${catalog.length - resources.length} use labeled song-specific search links.`);
if (process.argv.includes('--built')) {
  for (const song of catalog) {
    const html = readFileSync(`dist/songs/${song.slug}/index.html`, 'utf8');
    const section = html.match(/<section class="practice-panel"[\s\S]*?<\/section>/)?.[0] || '';
    const expected = links.filter(link => link.songId === song.id);
    if (!expected.length) {
      if (!section.includes('Find lyrics') || !section.includes('Find original song') || !section.includes('Find sing-along track') || !section.includes('link not yet curated') || (section.match(/rel="noopener noreferrer"/g) || []).length !== 3) throw new Error(`Missing labeled search links for ${song.title}`);
      continue;
    }
    if (expected.some(link => !section.includes(`href="${link.url}"`)) || (section.match(/rel="noopener noreferrer"/g) || []).length !== expected.length) throw new Error(`Missing rendered or protected link for ${song.title}`);
  }
  console.log(`All ${catalog.length} pre-rendered pages contain direct or clearly labeled search links with secure new-tab attributes.`);
}
if (process.argv.includes('--network')) {
  const results = [];
  let next = 0;
  async function work() {
    while (next < links.length) {
      const link = links[next++], youtube = new URL(link.url).hostname === 'www.youtube.com';
      const endpoint = youtube ? `https://www.youtube.com/oembed?url=${encodeURIComponent(link.url)}&format=json` : link.url;
      try {
        const response = await fetch(endpoint, { signal: AbortSignal.timeout(15000) });
        const metadata = response.ok && youtube ? await response.json() : null;
        results.push({ songId: link.songId, kind: link.kind, url: link.url, status: response.status, title: metadata?.title, channel: metadata?.author_name });
      } catch (error) { results.push({ songId: link.songId, kind: link.kind, url: link.url, status: 'unreachable', error: error.cause?.code || error.name }); }
    }
  }
  await Promise.all(Array.from({ length: 4 }, work));
  writeFileSync('artifacts/song-resource-check.json', JSON.stringify({ checkedAt: new Date().toISOString(), results }, null, 2) + '\n');
  console.log(JSON.stringify({ ok: results.filter(r => r.status === 200).length, review: results.filter(r => r.status !== 200) }, null, 2));
}
