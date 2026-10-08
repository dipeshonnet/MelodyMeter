import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index';
import { ApiError, body } from '../worker/src/security';
import { TestDB } from './database';
import type { Env } from '../worker/src/types';

const localEnv = (): Env => ({ DB: new TestDB() as unknown as D1Database, DEV_MODE: 'true', APP_ORIGIN: 'http://127.0.0.1:4321' });

test('local admin commands reject cross-origin, missing-origin and simple browser submissions', async () => {
  const env = localEnv();
  for (const headers of [
    { Origin: 'https://attacker.example', 'Content-Type': 'text/plain' },
    { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
    { 'Content-Type': 'text/plain' },
    { Origin: env.APP_ORIGIN, 'Content-Type': 'text/plain' },
    { Origin: env.APP_ORIGIN, 'Content-Type': 'application/jsonp' },
  ]) {
    const response = await worker.fetch(new Request('http://127.0.0.1:8787/api/admin/process', { method: 'POST', headers, body: '{}' }), env);
    assert.ok([403, 415].includes(response.status), `Rejected ${JSON.stringify(headers)}: ${response.status}`);
  }
  const legitimate = await worker.fetch(new Request('http://127.0.0.1:8787/api/admin/process', {
    method: 'POST', headers: { Origin: env.APP_ORIGIN, 'Content-Type': 'application/json; charset=utf-8' }, body: '{}',
  }), env);
  assert.equal(legitimate.status, 200);
});

test('hosted admin keeps bearer authentication and supports CLI requests without an Origin', async () => {
  const env = { ...localEnv(), DEV_MODE: undefined, APP_ORIGIN: 'https://melody.example', ADMIN_SECRET: 'test-admin' };
  for (const authorization of [undefined, 'Bearer wrong', 'Bearer test-admin']) {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authorization) headers.Authorization = authorization;
    const response = await worker.fetch(new Request('https://melody.example/api/admin/process', { method: 'POST', headers, body: '{}' }), env);
    assert.equal(response.status, authorization === 'Bearer test-admin' ? 200 : 403);
  }
});

test('JSON body limit stops and cancels streaming input without trusting Content-Length', async () => {
  let reads = 0, cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { reads++; controller.enqueue(new Uint8Array(4096).fill(32)); if (reads === 20) controller.close(); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const request = new Request('https://melody.example/api/audience', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
  await assert.rejects(body(request), (error: ApiError) => error.status === 413);
  assert.ok(reads <= 3, `Only read up to the size boundary, read ${reads} chunks`);
  assert.equal(cancelled, true);
});

test('JSON limit counts UTF-8 bytes and preserves valid input and error semantics', async () => {
  const request = (value: string) => new Request('https://melody.example/api/audience', { method: 'POST', body: value });
  await assert.rejects(body(request(JSON.stringify({ message: 'é'.repeat(5000) }))), (error: ApiError) => error.status === 413);
  assert.deepEqual(await body(request('{"message":"héllo"}')), { message: 'héllo' });
  assert.deepEqual(await body(request(' '.repeat(8190) + '{}')), {});
  for (const value of ['{', '[]', 'null', '42']) await assert.rejects(body(request(value)), (error: ApiError) => error.status === 400);
});
