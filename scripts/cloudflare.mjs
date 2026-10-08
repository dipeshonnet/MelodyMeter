import { readFileSync } from 'node:fs';
import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');
const credentials = readFileSync('.runtime-config/.wrangler/config/default.toml', 'utf8');
const token = credentials.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1];
if (!token) throw new Error('Sign in using the project Wrangler wrapper first.');
export const accountId = '68f7d76f0db9c20630b0b4b97505f5d0';
export async function cloudflare(path, method = 'GET', body) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000)
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(`Cloudflare ${response.status}: ${JSON.stringify(data.errors)}`);
  return data.result;
}
