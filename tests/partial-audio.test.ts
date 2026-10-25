import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index';
import { TestDB } from './database';
import { insertSong } from '../worker/src/store';
import { partialAudioFor } from '../shared/audio-assessments';
import { partialAudioSchema, primaryScore, type Song } from '../shared/rating';
import catalog from '../data/launch-catalog.json';
import type { Env } from '../worker/src/types';

const song = (catalog as Song[]).find(song => song.title === 'Easy on Me')!;
test('partial audio factors never manufacture an overall or unmeasured factors', async () => {
  const db = new TestDB();
  const env: Env = { DB: db as unknown as D1Database, DEV_MODE: 'true', APP_ORIGIN: 'http://127.0.0.1:4321' };
  await insertSong(env, song).run();
  const response = await worker.fetch(new Request(`http://127.0.0.1:8787/api/ratings/${encodeURIComponent(song.id)}`), env);
  assert.equal(response.status, 200);
  const rating = await response.json() as any;
  assert.equal(rating.ai, null);
  assert.equal(rating.audience.overall.count, 0);
  assert.deepEqual(primaryScore(rating.ai, rating.audience), { score: null, source: 'pending' });
  assert.equal(typeof rating.song.audio.factors.range, 'number');
  assert.ok(Object.keys(rating.song.audio.factors).every(key => ['range', 'sustain'].includes(key)));
  assert.equal(rating.song.audio.factors.pace, undefined);
  assert.equal(rating.song.audio.overall, undefined);
  const search = await worker.fetch(new Request('http://127.0.0.1:8787/api/search?q=Easy%20on%20Me'), env);
  assert.deepEqual((await search.json() as any).songs[0].audio, rating.song.audio);
});
test('partial audio schema rejects unsupported overall scores and inconsistent evidence', () => {
  const audio = partialAudioFor(song.id)!;
  assert.ok(partialAudioSchema.safeParse(audio).success);
  for (const bad of [
    { ...audio, overall: 7 }, { ...audio, factors: {}, reasons: {} },
    { ...audio, confidentPitchSeconds: audio.clipSeconds + 1 },
    { ...audio, reasons: {} }, { ...audio, sourceUrl: 'javascript:alert(1)' },
    { ...audio, sourceUrl: 'not a URL' }, { ...audio, clipSeconds: 901 },
  ]) assert.equal(partialAudioSchema.safeParse(bad).success, false);
});
test('full YouTube analysis is labeled separately and still has no overall', () => {
  const audio = partialAudioFor((catalog as Song[]).find(song => song.title === 'Sajni')!.id)!;
  assert.equal(audio.scope, 'full_recording');
  assert.equal(audio.method, 'foreground-pyin-full-v1');
  assert.ok(audio.clipSeconds > 160);
  assert.ok(partialAudioSchema.safeParse(audio).success);
  assert.equal('overall' in audio, false);
  assert.equal(partialAudioSchema.safeParse({ ...audio, scope: 'preview' }).success, false);
});
test('artist and album aliases cannot substitute recordings for these songs', () => {
  const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const title of ['My Heart Will Go On', 'Crazy in Love']) {
    const target = (catalog as Song[]).find(song => song.title === title)!;
    const audio = partialAudioFor(target.id);
    if (audio) assert.ok(normalize(audio.sourceTitle).includes(normalize(title)), `Wrong recording for ${title}: ${audio.sourceTitle}`);
  }
});
