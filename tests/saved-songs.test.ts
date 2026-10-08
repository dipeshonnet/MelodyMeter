import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index';
import { TestDB } from './database';
import { hash, now } from '../worker/src/security';
import { insertSong } from '../worker/src/store';
import { starterSongs } from '../data/starter';
import type { Env } from '../worker/src/types';

test('saved songs persist across sessions, remain private, and support idempotent add/remove', async () => {
  const env: Env = { DB: new TestDB() as unknown as D1Database, APP_ORIGIN: 'http://127.0.0.1:4321', DEV_MODE: 'true' };
  const tokens = ['a'.repeat(64), 'b'.repeat(64), 'c'.repeat(64), 'd'.repeat(64)];
  for (let i = 0; i < tokens.length; i++) await env.DB.prepare('INSERT INTO sessions VALUES(?,?,?)').bind(await hash(tokens[i]), i === 2 ? 'other-user' : 'first-user', i === 3 ? now() - 1 : now() + 600).run();
  await insertSong(env, starterSongs[0]).run();
  const request = (token = '', value?: unknown, origin = env.APP_ORIGIN) => new Request('http://127.0.0.1:8787/api/saved-songs', { method: value ? 'POST' : 'GET', headers: { Cookie: `mm_session=${token}`, Origin: origin, 'Content-Type': 'application/json' }, body: value ? JSON.stringify(value) : undefined });
  const list = async (token: string) => {
    const response = await worker.fetch(request(token), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    return response.json() as Promise<{ account: string; songs: { id: string }[] }>;
  };
  const first = await list(tokens[0]);
  const value = { account: first.account, changes: [{ songId: starterSongs[0].id, saved: true }] };
  assert.equal((await worker.fetch(request('', value), env)).status, 401);
  assert.equal((await worker.fetch(request(tokens[3]), env)).status, 401);
  assert.equal((await worker.fetch(request(tokens[0], value, 'https://evil.example'), env)).status, 403);
  assert.equal((await worker.fetch(request(tokens[0], value), env)).status, 200);
  assert.equal((await worker.fetch(request(tokens[0], value), env)).status, 200);
  assert.deepEqual((await list(tokens[1])).songs.map(song => song.id), [starterSongs[0].id]);
  assert.deepEqual((await list(tokens[2])).songs, []);
  assert.equal((await worker.fetch(request(tokens[2], value), env)).status, 409);
  assert.equal((await worker.fetch(request(tokens[0], { ...value, changes: [{ songId: 'invalid', saved: true }] }), env)).status, 400);
  assert.equal((await worker.fetch(request(tokens[0], { ...value, changes: [{ songId: 'starter:missing-song', saved: true }] }), env)).status, 404);
  assert.equal((await worker.fetch(request(tokens[0], { ...value, changes: [{ songId: starterSongs[0].id, saved: false }] }), env)).status, 200);
  assert.deepEqual((await list(tokens[1])).songs, []);
});
