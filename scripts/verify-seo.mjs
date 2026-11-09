import { readFileSync, existsSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { join } from 'node:path';

const root = 'dist';
const read = path => readFileSync(join(root, path), 'utf8');
const catalog = JSON.parse(read('catalog.json'));
const origin = new URL(catalog.url).origin;
const sitemap = read('sitemap.xml');
const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
const expected = ['/', '/how-we-rate/', '/privacy/', '/easy-songs/', '/hindi-songs/', '/english-songs/', ...catalog.songs.map(song => new URL(song.url).pathname)];
assert.equal(locations.length, expected.length, 'Sitemap must include every public page exactly once.');
assert.equal(new Set(locations).size, locations.length);
const titles = new Set();
for (const path of expected) {
  const url = new URL(path, origin).href;
  assert.ok(locations.includes(url), `Missing sitemap URL: ${url}`);
  const html = read(`${path.slice(1)}index.html`);
  assert.equal([...html.matchAll(/<h1[\s>]/g)].length, 1, `Expected one main heading: ${path}`);
  const title = html.match(/<title>(.*?)<\/title>/s)?.[1];
  assert.ok(title && !titles.has(title), `Missing or duplicate title: ${path}`);
  titles.add(title);
  assert.ok(html.includes(`<link rel="canonical" href="${url}"`), `Wrong canonical: ${path}`);
  assert.ok(html.includes(`<meta property="og:url" content="${url}"`), `Wrong sharing URL: ${path}`);
  assert.ok(html.includes(`content="${origin}/social-card.png"`), `Missing sharing image: ${path}`);
  assert.match(html, /<meta name="description" content="[^"]+"/);
  assert.doesNotMatch(html, /<meta name="robots" content="noindex/);
  assert.ok(html.includes('<meta name="twitter:card" content="summary_large_image"'));
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)];
  assert.equal(scripts.length, 1, `Expected one structured graph: ${path}`);
  const schema = JSON.parse(scripts[0][1]);
  assert.equal(schema['@context'], 'https://schema.org');
  assert.ok(schema['@graph'].find(node => node['@id'] === `${url}#webpage`));
  assert.doesNotMatch(scripts[0][1], /"(?:aggregateRating|reviewCount|ratingCount)"/);
  if (path.startsWith('/songs/')) {
    const song = catalog.songs.find(song => song.url === url);
    const recording = schema['@graph'].find(node => node['@type'] === 'MusicRecording');
    assert.equal(recording.name, song.title);
    assert.equal(recording.creditText, song.artist);
    assert.ok(html.includes('class="song-summary"'), `Missing readable song facts: ${path}`);
    const markdownPath = new URL(song.markdownUrl).pathname;
    assert.ok(html.includes(`type="text/markdown" href="${markdownPath}"`));
    const markdown = read(markdownPath.slice(1));
    assert.ok(markdown.includes(`Canonical page: ${url}`));
    assert.ok(markdown.includes('Live audience ratings are not included'));
    if (song.estimate?.source === 'full_audio') {
      assert.equal(song.estimate.confidence, 'low');
      assert.ok(markdown.includes(`Overall singing ease: ${song.estimate.overall}/10`));
      assert.ok(markdown.includes(song.estimate.sourceUrl));
    }
    if (!song.estimate) assert.ok(markdown.includes('No overall score is available.'));
    if (song.partialAudio) assert.equal(song.partialAudio.hasOverall, false);
  }
}
for (const path of ['verify', 'dev-mail', 'offline', 'song']) {
  const html = read(`${path}/index.html`);
  assert.ok(html.includes('content="noindex,nofollow"'), `Utility page must not be indexed: ${path}`);
  assert.ok(!html.includes('rel="canonical"'));
  assert.ok(!locations.includes(`${origin}/${path}/`));
}
const robots = read('robots.txt');
assert.match(robots, /User-agent: \*\nAllow: \/\n/);
assert.ok(robots.includes(`Sitemap: ${origin}/sitemap.xml`));
assert.ok(robots.includes('Disallow: /api/'));
assert.ok(!robots.includes('Disallow: /\n'));
const llms = read('llms.txt');
assert.ok(llms.includes(`${origin}/catalog.json`));
assert.ok(llms.includes('low confidence'));
assert.ok(existsSync(join(root, 'social-card.png')));
const image = readFileSync(join(root, 'social-card.png'));
assert.equal(image.readUInt32BE(16), 1200);
assert.equal(image.readUInt32BE(20), 630);
console.log(`Verified SEO for ${locations.length} public pages and ${catalog.songs.length} plain-text song summaries: canonicals, metadata, structured data, sitemap, crawler rules and estimate provenance.`);
