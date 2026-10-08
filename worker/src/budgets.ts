import { ApiError, identityKey, now } from './security';
import type { Env } from './types';

export function dayStart(time = now()): number { return Math.floor(time / 86400) * 86400; }
export function nextDay(time = now()): number { return dayStart(time) + 86400; }
export function monthStart(time = now()): number { const d = new Date(time * 1000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000; }
export function nextMonth(time = now()): number { const d = new Date(time * 1000); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000; }
const iso = (time: number) => new Date(time * 1000).toISOString();

export async function reserveEmail(env: Env, emailKey: string, request: Request): Promise<void> {
  const time = now();
  const ipKey = await identityKey(`ip:${request.headers.get('CF-Connecting-IP') || 'local'}`, env.EMAIL_HMAC_SECRET);
  const daily = Math.min(90, Number(env.EMAIL_DAILY_LIMIT) || 90);
  const monthly = Math.min(2700, Number(env.EMAIL_MONTHLY_LIMIT) || 2700);
  const result = await env.DB.prepare(`INSERT INTO budget_reservations(id,kind,identity_key,ip_key,amount,created_at)
    SELECT ?, 'email', ?, ?, 1, ? WHERE
    (SELECT COUNT(*) FROM budget_reservations WHERE kind='email' AND created_at>=?)<? AND
    (SELECT COUNT(*) FROM budget_reservations WHERE kind='email' AND created_at>=?)<? AND
    (SELECT COUNT(*) FROM budget_reservations WHERE kind='email' AND identity_key=? AND created_at>?)=0 AND
    (SELECT COUNT(*) FROM budget_reservations WHERE kind='email' AND identity_key=? AND created_at>?)<3 AND
    (SELECT COUNT(*) FROM budget_reservations WHERE kind='email' AND ip_key=? AND created_at>?)<20`)
    .bind(crypto.randomUUID(), emailKey, ipKey, time, dayStart(time), daily, monthStart(time), monthly, emailKey, time - 60, emailKey, time - 3600, ipKey, time - 3600).run();
  if (result.meta.changes) return;
  const [dailyCount, monthlyCount, recent] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM budget_reservations WHERE kind='email' AND created_at>=?").bind(dayStart(time)).first<{ n: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM budget_reservations WHERE kind='email' AND created_at>=?").bind(monthStart(time)).first<{ n: number }>(),
    env.DB.prepare("SELECT MIN(created_at) AS first, MAX(created_at) AS last, COUNT(*) AS n FROM budget_reservations WHERE kind='email' AND identity_key=? AND created_at>?").bind(emailKey, time - 3600).first<{ first: number; last: number; n: number }>(),
  ]);
  if ((monthlyCount?.n || 0) >= monthly) throw new ApiError(429, 'The free monthly email allowance has been reached. Your draft is saved on this device.', 'email_monthly_limit', iso(nextMonth(time)));
  if ((dailyCount?.n || 0) >= daily) throw new ApiError(429, 'The free daily email allowance has been reached. Your draft is saved on this device.', 'email_daily_limit', iso(nextDay(time)));
  const retry = recent && recent.n >= 3 ? recent.first + 3600 : recent?.last ? recent.last + 60 : time + 3600;
  throw new ApiError(429, 'Please wait before requesting another verification email.', 'email_rate_limit', iso(retry));
}
export async function reserveAI(env: Env, amount: number): Promise<boolean> {
  const budget = Math.min(8000, Number(env.AI_DAILY_BUDGET) || 8000);
  const result = await env.DB.prepare(`INSERT INTO budget_reservations(id,kind,amount,created_at)
    SELECT ?, 'ai', ?, ? WHERE COALESCE((SELECT SUM(amount) FROM budget_reservations WHERE kind='ai' AND created_at>=?),0)+?<=?`)
    .bind(crypto.randomUUID(), amount, now(), dayStart(), amount, budget).run();
  return !!result.meta.changes;
}
export async function reserveAction(env: Env, request: Request, action: string, limit: number): Promise<void> {
  const ip = await identityKey(`action:${request.headers.get('CF-Connecting-IP') || 'local'}`, env.EMAIL_HMAC_SECRET);
  const result = await env.DB.prepare(`INSERT INTO budget_reservations(id,kind,ip_key,amount,created_at) SELECT ?,?,?,1,? WHERE (SELECT COUNT(*) FROM budget_reservations WHERE kind=? AND ip_key=? AND created_at>?)<?`).bind(crypto.randomUUID(), action, ip, now(), action, ip, now() - 3600, limit).run();
  if (!result.meta.changes) throw new ApiError(429, 'Please try again later.', 'rate_limit', iso(now() + 3600));
}
