import { api, ClientError } from './common';
declare global { interface Window { turnstile?: { render: (element: HTMLElement, options: { sitekey: string; theme: string; size: string }) => string; getResponse: (id: string) => string; reset: (id: string) => void; }; } }
let local = false;
let ready: Promise<void> | undefined;
const widgets = new Map<string, string>();
async function initialize() {
  const health = await api<{ local: boolean }>('/api/health'); local = health.local;
  if (local) return;
  const config = JSON.parse(document.querySelector('#turnstile-config')?.textContent || '{}') as { siteKey?: string };
  if (!config.siteKey) throw new ClientError('Verification is not configured yet. Your draft remains on this device.');
  if (!window.turnstile) await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script'); script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; script.async = true;
    script.onload = () => resolve(); script.onerror = () => reject(new ClientError('The verification check could not load. Please retry.')); document.head.append(script);
  });
}
export async function challenge(containerId: string): Promise<string> {
  ready ||= initialize().catch(error => { ready = undefined; throw error; }); await ready;
  if (local) return 'local-test';
  const container = document.getElementById(containerId)!;
  if (!widgets.has(containerId)) {
    const config = JSON.parse(document.querySelector('#turnstile-config')!.textContent!) as { siteKey: string };
    widgets.set(containerId, window.turnstile!.render(container, { sitekey: config.siteKey, theme: 'light', size: 'flexible' }));
  }
  const response = window.turnstile!.getResponse(widgets.get(containerId)!);
  if (!response) throw new ClientError('Complete the verification check below, then submit again.');
  return response;
}
export function resetChallenge(containerId: string) { const id = widgets.get(containerId); if (id) window.turnstile?.reset(id); }
