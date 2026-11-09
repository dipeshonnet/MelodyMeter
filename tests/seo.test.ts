import test from 'node:test';
import assert from 'node:assert/strict';
import { songs } from '../src/lib/catalog';
import { collections, collectionSongs } from '../src/lib/collections';
import { canonicalUrl, jsonLd, songSchema, songMarkdown, songDescription } from '../src/lib/seo';

test('canonical URLs strip filter and tracking variants and preserve discovery file extensions', () => {
  assert.equal(canonicalUrl('/?ease=easy&utm_source=chat#songs'), 'https://melody.everydayai.work/');
  assert.equal(canonicalUrl('/songs/test?x=1'), 'https://melody.everydayai.work/songs/test/');
  assert.equal(canonicalUrl('/sitemap.xml'), 'https://melody.everydayai.work/sitemap.xml');
  assert.equal(canonicalUrl('/songs/test.md', 'https://preview.example/'), 'https://preview.example/songs/test.md');
});

test('structured data escapes script termination without changing recording metadata', () => {
  const song = { ...songs[0], title: '</script><script>alert(1)</script>\u2028' };
  const serialized = jsonLd(songSchema(song));
  assert.equal(serialized.includes('<'), false);
  assert.equal(serialized.includes('\u2028'), false);
  const graph = JSON.parse(serialized)['@graph'];
  assert.equal(graph.find((node: any) => node['@type'] === 'MusicRecording').name, song.title);
  assert.equal(serialized.includes('aggregateRating'), false);
  assert.equal(serialized.includes('reviewCount'), false);
});

test('plain-text descriptions retain audio provenance and never turn partial factors into overall scores', () => {
  const audio = songs.find(song => song.audioEstimate)!;
  assert.match(songDescription(audio), /low confidence/);
  assert.match(songMarkdown(audio), /low-confidence acoustic proxies/);
  assert.ok(songMarkdown(audio).includes(audio.audioEstimate!.sourceUrl));
  const partial = { ...songs.find(song => song.audio && !song.audioEstimate)!, ai: undefined };
  assert.match(songDescription(partial), /overall score is not available/);
  assert.match(songMarkdown(partial), /No overall score is available/);
  assert.doesNotMatch(songMarkdown(partial), /Overall singing ease:/);
  assert.ok(songMarkdown(partial).includes('Live audience ratings are not included'));
});

test('search landing pages contain the correct languages and use the primary saved estimate', () => {
  for (const collection of collections) {
    const selected = collectionSongs(collection, songs);
    assert.ok(selected.length > 0);
    if (collection.slug === 'easy-songs') assert.ok(selected.every(song => (song.audioEstimate?.overall ?? song.ai?.overall ?? 0) >= 7));
    if (collection.slug === 'hindi-songs') assert.ok(selected.every(song => song.language === 'Hindi'));
    if (collection.slug === 'english-songs') assert.ok(selected.every(song => song.language === 'English'));
  }
});
