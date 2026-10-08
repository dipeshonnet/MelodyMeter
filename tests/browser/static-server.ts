import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import type { AddressInfo } from 'node:net';
// An owned test server can be stopped to test real service-worker network failure.
export async function startStatic() {
  const root = resolve('dist');
  const server = createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
      let file = resolve(root, '.' + pathname);
      if (file !== root && !file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
      if (existsSync(file) && statSync(file).isDirectory()) file = resolve(file, 'index.html');
      if (!existsSync(file)) { response.writeHead(404, { 'Content-Type': 'application/json' }).end('{"error":"Offline test server has no API"}'); return; }
      const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
      response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' }); response.end(readFileSync(file));
    } catch { response.writeHead(500).end(); }
  });
  await new Promise<void>(ok => server.listen(0, '127.0.0.1', ok));
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: async () => { if (!server.listening) return; server.closeAllConnections(); await new Promise<void>((ok, reject) => server.close(error => error ? reject(error) : ok())); } };
}
