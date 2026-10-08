import test from 'node:test';
import assert from 'node:assert/strict';
import { SongCatalog, type CatalogFilters } from '../shared/catalog';
import { searchSongs, type Song } from '../shared/rating';
import { starterSongs } from '../data/starter';

const defaults: CatalogFilters = { query: '', language: 'all', decade: 'all', ease: 'all', sort: 'featured', favorites: new Set() };
function setup(songs = starterSongs) {
  const catalog = new SongCatalog();
  for (const song of songs) catalog.add(song);
  return catalog;
}

test('indexed search preserves title, artist, film, alias and Unicode matching', () => {
  const catalog = setup();
  for (const query of ['', '  Queen  ', 'rhapsody queen', 'कभी', 'CÉLINE', 'nonexistent']) {
    assert.deepEqual([...catalog.select({ ...defaults, query }).matches], searchSongs(starterSongs, query).map(song => song.id));
  }
  const song = { ...starterSongs[0], title: 'Café', aliases: ['गीत'] };
  const unicode = setup([song]);
  assert.deepEqual([...unicode.select({ ...defaults, query: 'CAFE\u0301 गीत' }).matches], [song.id]);
});

test('language, saved, decade and difficulty filters compose', () => {
  const catalog = setup();
  const song = starterSongs.find(song => song.year && song.ai)!;
  const filters = { ...defaults, language: 'saved', favorites: new Set([song.id]), decade: String(Math.floor(song.year! / 10) * 10), ease: song.ai!.overall >= 7 ? 'easy' : song.ai!.overall >= 5 ? 'medium' : 'hard' };
  assert.deepEqual([...catalog.select(filters).matches], [song.id]);
  assert.equal(catalog.select({ ...filters, favorites: new Set() }).matches.size, 0);
  assert.equal(catalog.select({ ...filters, language: song.language === 'Hindi' ? 'English' : 'Hindi' }).matches.size, 0);
  assert.equal(catalog.select({ ...filters, decade: '1800' }).matches.size, 0);
});

test('ease boundaries include 5 in medium, 7 in easy and exclude unrated songs', () => {
  const songs = [4.9, 5, 6.9, 7, null].map((score, index): Song => ({ ...starterSongs[0], id: String(index), ai: score === null ? undefined : { ...starterSongs[0].ai!, overall: score } }));
  const catalog = setup(songs);
  assert.deepEqual([...catalog.select({ ...defaults, ease: 'hard' }).matches], ['0']);
  assert.deepEqual([...catalog.select({ ...defaults, ease: 'medium' }).matches], ['1', '2']);
  assert.deepEqual([...catalog.select({ ...defaults, ease: 'easy' }).matches], ['3']);
});

test('sorts keep unrated songs last, ties stable, and featured order intact', () => {
  const songs = [5, null, 9, 5].map((score, index): Song => ({ ...starterSongs[0], id: String(index), title: ['Zulu', 'Beta', 'Alpha', 'Delta'][index], ai: score === null ? undefined : { ...starterSongs[0].ai!, overall: score } }));
  const catalog = setup(songs);
  const ids = (sort: string) => catalog.select({ ...defaults, sort }).ordered.map(song => song.id);
  assert.deepEqual(ids('easy'), ['2', '0', '3', '1']);
  assert.deepEqual(ids('hard'), ['0', '3', '2', '1']);
  assert.deepEqual(ids('title'), ['2', '1', '3', '0']);
  assert.deepEqual(ids('featured'), ['0', '1', '2', '3']);
});

test('new recordings invalidate ordering and duplicate IDs preserve the existing song', () => {
  const catalog = setup([starterSongs[0]]);
  catalog.select({ ...defaults, sort: 'title' });
  assert.equal(catalog.add({ ...starterSongs[0], title: 'Replacement' }), false);
  assert.equal(catalog.get(starterSongs[0].id), starterSongs[0]);
  assert.equal(catalog.add(starterSongs[1]), true);
  assert.equal(catalog.select({ ...defaults, sort: 'title' }).ordered.length, 2);
});

test('audience updates change filters and ranking; unchanged inputs reuse ordering', () => {
  const catalog = setup(starterSongs.slice(0, 2));
  const options = { ...defaults, sort: 'easy' };
  const before = catalog.select(options).ordered;
  assert.equal(catalog.select({ ...options, query: 'Queen' }).ordered, before);
  catalog.setScore(starterSongs[0].id, 10);
  const after = catalog.select(options).ordered;
  assert.notEqual(after, before);
  assert.equal(after[0].id, starterSongs[0].id);
  assert.ok(catalog.select({ ...options, ease: 'easy' }).matches.has(starterSongs[0].id));
  catalog.setScore(starterSongs[0].id, 10);
  assert.equal(catalog.select(options).ordered, after);
  catalog.setScore(starterSongs[0].id, null);
  assert.equal(catalog.select(options).ordered.at(-1)!.id, starterSongs[0].id);
});
