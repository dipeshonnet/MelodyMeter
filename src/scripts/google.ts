import { api, ClientError, syncSavedSongs } from './common';

interface GoogleIdentity {
  initialize(options: { client_id: string; nonce: string; auto_select: boolean; callback: (response: { credential: string }) => void }): void;
  renderButton(element: HTMLElement, options: { type: string; theme: string; size: string; text: string; width: number }): void;
}
declare global { interface Window { google?: { accounts: { id: GoogleIdentity } }; } }
let loading: Promise<void> | undefined;
export async function showGoogleButton(container: HTMLElement, signedIn: () => void, failed: (error: unknown) => void) {
  loading ||= new Promise<void>((resolve, reject) => {
    if (window.google?.accounts.id) { resolve(); return; }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
    script.onload = () => resolve();
    script.onerror = () => { script.remove(); loading = undefined; reject(new ClientError('Google sign-in could not load. Try again or use email.')); };
    document.head.append(script);
  });
  await loading;
  const config = await api<{ clientId: string; nonce: string }>('/api/auth/google/start', { method: 'POST', body: '{}' });
  window.google!.accounts.id.initialize({
    client_id: config.clientId, nonce: config.nonce, auto_select: false,
    callback: response => {
      api('/api/auth/google', { method: 'POST', body: JSON.stringify({ credential: response.credential }) })
        .then(() => { signedIn(); void syncSavedSongs(); }).catch(failed);
    },
  });
  container.replaceChildren();
  window.google!.accounts.id.renderButton(container, { type: 'standard', theme: 'outline', size: 'large', text: 'continue_with', width: Math.min(320, container.clientWidth || 280) });
}
