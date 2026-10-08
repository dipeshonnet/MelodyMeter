import { ApiError, hash, identityKey, localDev, normalizeEmail, now, randomToken, sessionCookie } from './security';
import { reserveAction } from './budgets';
import type { Env } from './types';

interface GoogleKey extends JsonWebKey { kid: string; }
let cachedKeys: { keys: GoogleKey[]; expires: number } | undefined;
function bytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
const invalid = () => new ApiError(401, 'Google sign-in expired or could not be verified. Please try again.', 'invalid_google_token');
export function googleConfigured(env: Env): boolean {
  return !!env.GOOGLE_CLIENT_ID?.endsWith('.apps.googleusercontent.com') && !!env.EMAIL_HMAC_SECRET && env.EMAIL_HMAC_SECRET.length >= 32;
}
export async function startGoogle(request: Request, env: Env) {
  if (!googleConfigured(env)) throw new ApiError(503, 'Google sign-in is not configured yet.', 'google_unconfigured');
  await reserveAction(env, request, 'google-login', 30);
  const nonce = randomToken();
  await env.DB.prepare('DELETE FROM google_login_nonces WHERE expires_at<=?').bind(now()).run();
  await env.DB.prepare('INSERT INTO google_login_nonces(token_hash,expires_at) VALUES(?,?)').bind(await hash(nonce), now() + 600).run();
  return { clientId: env.GOOGLE_CLIENT_ID!, nonce, cookie: `mm_google_nonce=${nonce}; Path=/api/auth/google; Max-Age=600; HttpOnly; SameSite=Lax${localDev(env) ? '' : '; Secure'}` };
}
export async function verifyGoogleToken(credential: unknown, clientId: string, nonce: string) {
  if (typeof credential !== 'string' || credential.length > 7000) throw invalid();
  try {
    const parts = credential.split('.');
    if (parts.length !== 3) throw invalid();
    const header = JSON.parse(new TextDecoder().decode(bytes(parts[0])));
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw invalid();
    if (!cachedKeys || cachedKeys.expires <= now()) {
      const response = await fetch('https://www.googleapis.com/oauth2/v3/certs', { signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw new Error('keys_unavailable');
      const result = await response.json() as { keys: GoogleKey[] };
      if (!Array.isArray(result.keys)) throw new Error('keys_unavailable');
      const maxAge = Number(response.headers.get('Cache-Control')?.match(/max-age=(\d+)/)?.[1] || 300);
      cachedKeys = { keys: result.keys, expires: now() + Math.min(maxAge, 3600) };
    }
    const jwk = cachedKeys.keys.find(key => key.kid === header.kid && key.kty === 'RSA');
    if (!jwk) throw invalid();
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, bytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))) throw invalid();
    const claims = JSON.parse(new TextDecoder().decode(bytes(parts[1])));
    if (!['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss) || claims.aud !== clientId ||
      (claims.azp !== undefined && claims.azp !== clientId) || typeof claims.exp !== 'number' || claims.exp <= now() ||
      typeof claims.iat !== 'number' || claims.iat > now() + 60 || claims.nonce !== nonce ||
      typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 255 || claims.email_verified !== true || typeof claims.email !== 'string') throw invalid();
    const email = normalizeEmail(claims.email);
    // Only merge email votes when Google is authoritative for that mailbox.
    // Other Google accounts use a stable provider identity instead.
    return email.endsWith('@gmail.com') || (typeof claims.hd === 'string' && claims.hd) ? email : `google:${claims.sub}`;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw invalid();
  }
}
export async function finishGoogle(request: Request, env: Env, input: Record<string, unknown>) {
  if (!googleConfigured(env)) throw new ApiError(503, 'Google sign-in is not configured yet.', 'google_unconfigured');
  await reserveAction(env, request, 'google-verify', 30);
  const nonce = request.headers.get('Cookie')?.match(/(?:^|;\s*)mm_google_nonce=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!nonce) throw invalid();
  const nonceHash = await hash(nonce);
  const pending = await env.DB.prepare('SELECT token_hash FROM google_login_nonces WHERE token_hash=? AND expires_at>?').bind(nonceHash, now()).first();
  if (!pending) throw invalid();
  const identity = await verifyGoogleToken(input.credential, env.GOOGLE_CLIENT_ID!, nonce);
  const emailKey = await identityKey(identity, env.EMAIL_HMAC_SECRET);
  const token = randomToken();
  const results = await env.DB.batch([
    env.DB.prepare('INSERT INTO sessions(token_hash,email_key,expires_at) SELECT ?,?,? FROM google_login_nonces WHERE token_hash=? AND expires_at>?').bind(await hash(token), emailKey, now() + 2592000, nonceHash, now()),
    env.DB.prepare('DELETE FROM google_login_nonces WHERE token_hash=?').bind(nonceHash),
  ]);
  if (!results[0].meta.changes) throw invalid();
  return sessionCookie(token, env);
}
