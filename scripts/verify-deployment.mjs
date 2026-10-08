import { readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';

const origin = process.env.SITE_URL || 'https://melody.everydayai.work';
const expected = readFileSync('dist/asset-manifest.json', 'utf8');
const revision = process.env.GITHUB_SHA || Date.now().toString();
let failure;
for (let attempt = 1; attempt <= 6; attempt++) {
  try {
    const [manifest, health] = await Promise.all([
      fetch(`${origin}/asset-manifest.json?revision=${encodeURIComponent(revision)}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) }),
      fetch(`${origin}/api/health`, { cache: 'no-store', signal: AbortSignal.timeout(15000) }),
    ]);
    if (!manifest.ok || await manifest.text() !== expected) throw new Error('The live assets do not match the build yet.');
    if (!health.ok || !(await health.json()).ok) throw new Error('The live API health check failed.');
    console.log(`Verified the deployed assets and API at ${origin}.`);
    process.exit(0);
  } catch (error) {
    failure = error;
    console.log(`Deployment verification attempt ${attempt}/6 failed.`);
    if (attempt < 6) await setTimeout(10000);
  }
}
throw failure;
