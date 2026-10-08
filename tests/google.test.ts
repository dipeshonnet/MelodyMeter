import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/src/index';
import { TestDB } from './database';
import { hash, identityKey, now } from '../worker/src/security';
import { verifyGoogleToken } from '../worker/src/google';
import type { Env } from '../worker/src/types';
import { starterSongs } from '../data/starter';
import { insertSong } from '../worker/src/store';

test('Google credentials verify signature, claims, browser binding, one-use nonce and existing voter identity', async () => {
  const clientId = 'test.apps.googleusercontent.com';
  const env: Env = { DB: new TestDB() as unknown as D1Database, APP_ORIGIN: 'http://127.0.0.1:4321', DEV_MODE: 'true', GOOGLE_CLIENT_ID: clientId, EMAIL_HMAC_SECRET: 'google-test-secret-at-least-thirty-two-characters' };
  const request = (path: string, body: unknown, cookie = '', origin = env.APP_ORIGIN) => new Request(`http://127.0.0.1:8787${path}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
  const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ keys: [{ ...publicKey, kid: 'google-test' }] }, { headers: { 'Cache-Control': 'max-age=300' } });
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const sign = async (nonce: string, overrides = {}) => {
    const content = `${encode({ alg: 'RS256', kid: 'google-test' })}.${encode({ iss: 'https://accounts.google.com', aud: clientId, sub: '12345', email: 'singer@gmail.com', email_verified: true, iat: now(), exp: now() + 3600, nonce, ...overrides })}`;
    return `${content}.${Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(content))).toString('base64url')}`;
  };
  try {
    assert.equal((await worker.fetch(request('/api/auth/google/start', {}, '', 'https://evil.example'), env)).status, 403);
    const start = await worker.fetch(request('/api/auth/google/start', {}), env);
    assert.equal(start.status, 200);
    const { nonce } = await start.json() as { nonce: string };
    const cookie = start.headers.get('Set-Cookie')!.split(';')[0];
    const credential = await sign(nonce);
    assert.equal((await worker.fetch(request('/api/auth/google', { credential }), env)).status, 401);
    for (const overrides of [{ aud: 'wrong-client' }, { iss: 'https://evil.example' }, { exp: now() - 1 }, { email_verified: false }, { nonce: 'wrong' }, { azp: 'wrong-client' }, { iat: now() + 120 }]) {
      assert.equal((await worker.fetch(request('/api/auth/google', { credential: await sign(nonce, overrides) }, cookie), env)).status, 401);
    }
    const parts = credential.split('.');
    const tampered = `${parts[0]}.${encode({ email: 'attacker@gmail.com' })}.${parts[2]}`;
    assert.equal((await worker.fetch(request('/api/auth/google', { credential: tampered }, cookie), env)).status, 401);
    assert.equal(await verifyGoogleToken(await sign(nonce, { email: 'person@example.org' }), clientId, nonce), 'google:12345');
    const result = await worker.fetch(request('/api/auth/google', { credential }, cookie), env);
    assert.equal(result.status, 200);
    const session = result.headers.get('Set-Cookie')!;
    assert.match(session, /HttpOnly; SameSite=Lax/);
    const token = session.match(/mm_session=([a-f0-9]{64})/)![1];
    const row = await env.DB.prepare('SELECT email_key FROM sessions WHERE token_hash=?').bind(await hash(token)).first<{ email_key: string }>();
    assert.equal(row!.email_key, await identityKey('singer@gmail.com', env.EMAIL_HMAC_SECRET));
    await insertSong(env, starterSongs[0]).run();
    const sessionCookie = session.split(';')[0];
    const ratingInput = { songId: starterSongs[0].id, rating: { overall: 7, factors: {} } };
    const vote = await worker.fetch(request('/api/audience', ratingInput, sessionCookie), env);
    assert.equal(vote.status, 200);
    assert.equal((await vote.json() as { status: string }).status, 'counted');
    await worker.fetch(request('/api/audience', { ...ratingInput, rating: { overall: 8, factors: {} } }, sessionCookie), env);
    const counted = await env.DB.prepare('SELECT COUNT(*) AS count,MAX(overall) AS score FROM votes WHERE song_id=?').bind(starterSongs[0].id).first<{ count: number; score: number }>();
    assert.equal(counted!.count, 1);
    assert.equal(counted!.score, 8);
    assert.equal((await worker.fetch(request('/api/auth/google', { credential }, cookie), env)).status, 401);
    const expiredStart = await worker.fetch(request('/api/auth/google/start', {}), env);
    const expired = await expiredStart.json() as { nonce: string };
    await env.DB.prepare('UPDATE google_login_nonces SET expires_at=?').bind(now() - 1).run();
    assert.equal((await worker.fetch(request('/api/auth/google', { credential: await sign(expired.nonce) }, expiredStart.headers.get('Set-Cookie')!.split(';')[0]), env)).status, 401);
    assert.equal((await worker.fetch(request('/api/auth/google/start', {}), { ...env, GOOGLE_CLIENT_ID: undefined })).status, 503);
  } finally { globalThis.fetch = originalFetch; }
});
