import { defineConfig } from 'astro/config';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export default defineConfig({
  site: process.env.SITE_URL || 'http://localhost:4321',
  output: 'static',
  integrations: [{ name: 'offline-assets', hooks: { 'astro:build:done': ({ dir }) => {
    const output = fileURLToPath(dir);
    const assets = readdirSync(join(output, '_astro')).filter(file => /\.(?:js|css|woff2?)$/.test(file)).map(file => `/_astro/${file}`);
    writeFileSync(join(output, 'asset-manifest.json'), JSON.stringify(assets));
    const version = createHash('sha256').update(JSON.stringify(assets)).digest('hex').slice(0, 12);
    const sw = join(output, 'sw.js'); writeFileSync(sw, readFileSync(sw, 'utf8').replace('melodymeter-public-v1', `melodymeter-public-${version}`));
  } } }],
  vite: {
    cacheDir: process.argv.includes('dev') ? 'node_modules/.vite-melodymeter-dev' : 'node_modules/.vite-melodymeter-build',
    server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
    preview: { proxy: { '/api': 'http://127.0.0.1:8787' } },
  },
});
