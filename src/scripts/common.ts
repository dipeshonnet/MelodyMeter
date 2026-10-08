import type { Song } from '../../shared/rating';

export class ClientError extends Error { constructor(message: string, public code?: string, public retryAt?: string) { super(message); } }
export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try { response = await fetch(path, { ...init, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...init.headers }, signal: AbortSignal.timeout(20000) }); }
  catch { throw new ClientError(navigator.onLine ? 'The rating service is unavailable. Your draft stays on this device.' : 'You’re offline. Reconnect to submit or request a rating.'); }
  let data: Record<string, unknown>;
  try { data = await response.json(); } catch { throw new ClientError('The rating service is not available yet. Saved estimates still work.'); }
  if (!response.ok) throw new ClientError(String(data.error || 'Please try again.'), data.code as string | undefined, data.retryAt as string | undefined);
  return data as T;
}
export function escapeHTML(text: unknown): string { return String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!)); }
export function readStorage<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback; } catch { return fallback; } }
export function writeStorage(key: string, value: unknown): void { try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Read-only browsers still support browsing and online voting. */ } }
let savedAccount = readStorage<string | null>('mm:favorites:account', null);
const favoritesKey = () => savedAccount ? `mm:favorites:account:${savedAccount}` : 'mm:favorites:v1';
const pendingKey = (account: string) => `mm:favorites:pending:${account}`;
export function savedSongs(): string[] { return readStorage<string[]>(favoritesKey(), []); }
function favoritesChanged(songs?: Song[]) {
  updateFavorites(); document.dispatchEvent(new CustomEvent('favorites-changed', { detail: { songs } }));
}
let syncing: Promise<void> | undefined;
let syncAgain = false;
function applySavedSongs(remote: { account: string; songs: Song[] }) {
  const ids = new Set(remote.songs.map(song => song.id));
  for (const [id, saved] of Object.entries(readStorage<Record<string, boolean>>(pendingKey(remote.account), {}))) {
    if (saved) ids.add(id); else ids.delete(id);
  }
  writeStorage(`mm:favorites:account:${remote.account}`, [...ids]);
  writeStorage(`mm:favorites:songs:${remote.account}`, remote.songs);
  favoritesChanged(remote.songs);
}
export function syncSavedSongs(): Promise<void> {
  if (syncing) { syncAgain = true; return syncing; }
  syncing = (async () => {
    do {
      syncAgain = false;
      try {
        let remote = await api<{ account: string; songs: Song[] }>('/api/saved-songs');
        const account = remote.account;
        savedAccount = account;
        writeStorage('mm:favorites:account', account);
        const guest = readStorage<string[]>('mm:favorites:v1', []);
        const pending = readStorage<Record<string, boolean>>(pendingKey(account), {});
        // Import device bookmarks once. Removals queued by this account take precedence.
        for (const id of guest) if (!(id in pending)) pending[id] = true;
        writeStorage(pendingKey(account), pending);
        applySavedSongs(remote);
        const changes = Object.entries(pending);
        for (let offset = 0; offset < changes.length; offset += 50) {
          const batch = changes.slice(offset, offset + 50);
          await api('/api/saved-songs', { method: 'POST', body: JSON.stringify({ account, changes: batch.map(([songId, saved]) => ({ songId, saved })) }) });
          const remaining = readStorage<Record<string, boolean>>(pendingKey(account), {});
          for (const [id, saved] of batch) if (remaining[id] === saved) delete remaining[id];
          writeStorage(pendingKey(account), remaining);
          writeStorage('mm:favorites:v1', readStorage<string[]>('mm:favorites:v1', []).filter(id => !batch.some(([songId]) => id === songId)));
        }
        if (changes.length) remote = await api<{ account: string; songs: Song[] }>('/api/saved-songs');
        if (remote.account !== account || savedAccount !== account) { syncAgain = true; continue; }
        applySavedSongs(remote);
      } catch (error) {
        if (error instanceof ClientError && error.code === 'sign_in_required') {
          savedAccount = null; writeStorage('mm:favorites:account', null); favoritesChanged();
        } else if (error instanceof ClientError && error.code === 'account_changed') {
          syncAgain = true;
        }
        // Failed requests leave account-scoped changes queued for the next connection.
      }
    } while (syncAgain && navigator.onLine);
  })().finally(() => { syncing = undefined; });
  return syncing;
}
export function cachedSavedSongs(): Song[] {
  return savedAccount ? readStorage<Song[]>(`mm:favorites:songs:${savedAccount}`, []) : [];
}
export function toast(message: string): void {
  const target = document.querySelector<HTMLElement>('#toast');
  if (!target) return;
  target.textContent = message; target.hidden = false;
  window.setTimeout(() => { target.hidden = true; }, 3500);
}
export function updateFavorites() {
  const saved = new Set(savedSongs());
  document.querySelectorAll<HTMLButtonElement>('[data-save]').forEach(button => { const active = saved.has(button.dataset.save!); button.setAttribute('aria-pressed', String(active)); button.setAttribute('aria-label', `${active ? 'Unsave' : 'Save'} ${button.closest('article')?.querySelector('h2')?.textContent || document.querySelector('h1')?.textContent || 'song'}`); });
  const count = document.querySelector('#saved-count'); if (count) count.textContent = String(saved.size);
}
document.addEventListener('click', event => {
  const button = (event.target as Element).closest<HTMLButtonElement>('[data-save]');
  if (!button) return;
  const id = button.dataset.save!;
  if (!id) return;
  const saved = savedSongs(); const exists = saved.includes(id);
  writeStorage(favoritesKey(), exists ? saved.filter(s => s !== id) : [...saved, id]);
  if (savedAccount) {
    const pending = readStorage<Record<string, boolean>>(pendingKey(savedAccount), {});
    pending[id] = !exists; writeStorage(pendingKey(savedAccount), pending);
  }
  if (!exists && !import.meta.env.DEV && 'serviceWorker' in navigator) {
    const href = button.closest('article')?.querySelector<HTMLAnchorElement>('.song-title-link')?.href || location.href;
    navigator.serviceWorker.ready.then(registration => (navigator.serviceWorker.controller || registration.active)?.postMessage({ type: 'SAVE_PAGE', url: href })).catch(() => {});
  }
  favoritesChanged(); toast(exists ? 'Song removed from saved songs' : savedAccount ? 'Song saved. Syncing with your account…' : 'Song saved on this device. Sign in to sync.');
  void syncSavedSongs();
});
window.addEventListener('storage', () => { savedAccount = readStorage<string | null>('mm:favorites:account', null); favoritesChanged(cachedSavedSongs()); });
window.addEventListener('online', () => { void syncSavedSongs(); });
void syncSavedSongs();
updateFavorites();
function connectivity() { const notice = document.querySelector<HTMLElement>('#connection-notice'); if (notice) notice.hidden = navigator.onLine; }
window.addEventListener('online', connectivity); window.addEventListener('offline', connectivity); connectivity();
interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: string }>; }
let installPrompt: InstallEvent | undefined;
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event as InstallEvent; const button = document.querySelector<HTMLButtonElement>('#install-app'); if (button) button.hidden = false; });
document.querySelector('#install-app')?.addEventListener('click', async () => { if (!installPrompt) return; await installPrompt.prompt(); await installPrompt.userChoice; installPrompt = undefined; const button = document.querySelector<HTMLButtonElement>('#install-app'); if (button) button.hidden = true; });
if (!import.meta.env.DEV && 'serviceWorker' in navigator && !['/verify/', '/dev-mail/'].includes(location.pathname)) window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
api<{ local: boolean }>('/api/health').then(health => { const link = document.querySelector<HTMLElement>('#local-mail-link'); if (link) link.hidden = !health.local; }).catch(() => {});
