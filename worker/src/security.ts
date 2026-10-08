import type { Env } from './types';

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = 'request_error', public retryAt?: string) { super(message); }
}
export const now = () => Math.floor(Date.now() / 1000);
export function localDev(env: Env): boolean {
  if (env.DEV_MODE !== 'true') return false;
  try { const u = new URL(env.APP_ORIGIN); return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname); } catch { return false; }
}
export function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, 'Enter a valid email address.', 'invalid_email');
  return email;
}
export async function hash(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))).map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function identityKey(value: string, secret: string | undefined): Promise<string> {
  if (!secret || secret.length < 32) throw new ApiError(503, 'Email verification is not configured yet.', 'verification_unconfigured');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)))).map(b => b.toString(16).padStart(2, '0')).join('');
}
export function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b => b.toString(16).padStart(2, '0')).join('');
}
export function checkOrigin(request: Request, env: Env): void {
  if (request.headers.get('Origin') !== new URL(env.APP_ORIGIN).origin) throw new ApiError(403, 'Open MelodyMeter to submit this request.', 'invalid_origin');
  if (request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') throw new ApiError(415, 'Send this request as JSON.', 'invalid_content_type');
}
export async function body(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('content-length') || 0) > 8192) throw new ApiError(413, 'This submission is too large.');
  // Content-Length may be absent or inaccurate. Bound the bytes read before
  // decoding or parsing, rather than buffering the entire attacker-supplied body.
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 8192) {
          await reader.cancel().catch(() => {});
          throw new ApiError(413, 'This submission is too large.');
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const text = new TextDecoder().decode(bytes);
  try { const value: unknown = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value as Record<string, unknown>; }
  catch { throw new ApiError(400, 'This submission could not be read.'); }
}
export async function turnstile(request: Request, env: Env, token: unknown): Promise<void> {
  if (localDev(env) && ['localhost', '127.0.0.1'].includes(new URL(request.url).hostname)) return;
  if (!env.TURNSTILE_SECRET_KEY) throw new ApiError(503, 'Submissions are not configured yet.', 'verification_unconfigured');
  if (typeof token !== 'string' || token.length > 2048 || !token) throw new ApiError(400, 'Please complete the verification check.', 'challenge_required');
  let result: { success?: boolean; hostname?: string };
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: request.headers.get('CF-Connecting-IP') || undefined }), signal: AbortSignal.timeout(10000) });
    result = await response.json();
  } catch { throw new ApiError(503, 'The verification check is temporarily unavailable. Try again.'); }
  if (!result.success || result.hostname !== new URL(env.APP_ORIGIN).hostname) throw new ApiError(400, 'The verification check expired. Please try again.', 'challenge_failed');
}
export async function sessionEmail(request: Request, env: Env): Promise<string | null> {
  const token = request.headers.get('Cookie')?.match(/(?:^|;\s*)mm_session=([a-f0-9]{64})(?:;|$)/)?.[1];
  if (!token) return null;
  const row = await env.DB.prepare('SELECT email_key FROM sessions WHERE token_hash=? AND expires_at>?').bind(await hash(token), now()).first<{ email_key: string }>();
  return row?.email_key ?? null;
}
export function sessionCookie(token: string, env: Env): string {
  return `mm_session=${token}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax${localDev(env) ? '' : '; Secure'}`;
}
export function assertToken(token: unknown): asserts token is string {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new ApiError(400, 'This verification link is invalid.', 'invalid_token');
}
