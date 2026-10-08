/* Public content only. Verification pages, mail, and ALL API traffic bypass the cache. */
const CACHE = 'melodymeter-public-v1';
const PRIVATE = ['/verify', '/dev-mail', '/api'];
const isPrivate = pathname => PRIVATE.some(prefix => pathname === prefix || pathname.startsWith(prefix + '/'));
self.addEventListener('install', event => { event.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  let assets = []; try { const response = await fetch('/asset-manifest.json', { cache: 'no-store' }); if (response.ok) assets = await response.json(); } catch {}
  await cache.addAll(['/', '/offline/', '/song/', '/how-we-rate/', '/manifest.webmanifest', '/favicon.svg', '/icons/icon-192.png', '/icons/icon-512.png', ...assets]);
})()); });
self.addEventListener('activate', event => { event.waitUntil((async () => { for (const name of await caches.keys()) if (name.startsWith('melodymeter-public-') && name !== CACHE) await caches.delete(name); await self.clients.claim(); })()); });
async function remember(request, response) {
  if (!response.ok || response.type === 'opaque') return;
  try { const cache = await caches.open(CACHE); await cache.put(request, response.clone());
  const keys = await cache.keys();
  if (keys.length > 5000) { const protectedPaths = new Set(['/', '/offline/', '/song/', '/how-we-rate/']); const removable = keys.filter(key => !protectedPaths.has(new URL(key.url).pathname)); for (const key of removable.slice(0, keys.length - 5000)) await cache.delete(key); }
  } catch { /* Storage limits must not interrupt an online read. */ }
}
self.addEventListener('fetch', event => {
  const request = event.request, url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || isPrivate(url.pathname)) return;
  if (request.mode === 'navigate') event.respondWith((async () => { try { const response = await fetch(request); if (response.ok) await remember(request, response); return response; } catch { return (await caches.match(request, { ignoreVary: true })) || (['/', '/song/'].includes(url.pathname) ? await caches.match(url.pathname, { ignoreVary: true }) : null) || (await caches.match('/offline/', { ignoreVary: true })); } })());
  else if (['script', 'style', 'image', 'font', 'manifest'].includes(request.destination)) event.respondWith((async () => { const saved = await caches.match(request, { ignoreVary: true }); if (saved) return saved; const response = await fetch(request); await remember(request, response); return response; })());
});
self.addEventListener('message', event => {
  if (event.data?.type !== 'SAVE_PAGE') return;
  event.waitUntil((async () => {
    const url = new URL(event.data.url, self.location.origin);
    if (url.origin !== self.location.origin || isPrivate(url.pathname) || url.hash) return;
    const response = await fetch(url.href); if (!response.ok) return;
    const html = await response.clone().text(); await remember(url.href, response);
    const assets = [...html.matchAll(/(?:src|href)="(\/_astro\/[^"<>]+)"/g)].map(match => match[1]);
    for (const asset of new Set(assets)) { try { const assetResponse = await fetch(asset); await remember(asset, assetResponse); } catch {} }
  })());
});
