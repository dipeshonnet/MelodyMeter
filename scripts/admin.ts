export const base = (process.env.MELODYMETER_API || 'http://127.0.0.1:8787').replace(/\/$/, '');
const origin = process.env.MELODYMETER_ORIGIN || (base.includes('127.0.0.1') ? 'http://127.0.0.1:4321' : 'https://melody.everydayai.work');
export async function admin<T>(path: string, value?: unknown): Promise<T> {
  if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname) && !process.env.MELODYMETER_ADMIN_SECRET) throw new Error('Set MELODYMETER_ADMIN_SECRET locally for a hosted import. Do not put secrets in catalog files.');
  const response = await fetch(`${base}/api/admin/${path}`, { method: value === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...(process.env.MELODYMETER_ADMIN_SECRET ? { Authorization: `Bearer ${process.env.MELODYMETER_ADMIN_SECRET}` } : {}) }, body: value === undefined ? undefined : JSON.stringify(value), signal: AbortSignal.timeout(30000) });
  const result = await response.json() as { error?: string };
  if (!response.ok) throw new Error(result.error || `Catalog request failed (${response.status}).`);
  return result as T;
}
