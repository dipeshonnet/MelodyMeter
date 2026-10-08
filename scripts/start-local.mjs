import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
const children = new Set();
function start(args) { const child = spawn(process.execPath, args, { stdio: 'inherit' }); children.add(child); child.on('exit', () => children.delete(child)); return child; }
async function run(args) { const child = start(args); await new Promise((ok, fail) => { child.on('error', fail); child.on('exit', code => code === 0 ? ok() : fail(new Error('Local setup failed. See the command output.'))); }); }
function stop() { for (const child of children) child.kill('SIGTERM'); }
process.on('SIGINT', () => { stop(); process.exit(0); }); process.on('SIGTERM', () => { stop(); process.exit(0); });
try {
  await run(['scripts/setup-local.mjs']);
  await run(['scripts/icons.mjs']);
  await run(['scripts/run.mjs', 'wrangler', 'd1', 'migrations', 'apply', 'melodymeter', '--local', '--config', 'worker/wrangler.local.jsonc']);
  const existing = await fetch('http://127.0.0.1:8787/api/health').then(r => r.ok).catch(() => false);
  if (!existing) start(['scripts/run.mjs', 'wrangler', 'dev', '--config', 'worker/wrangler.local.jsonc', '--port', '8787']);
  let ready = false;
  for (let attempt = 0; attempt < 30; attempt++) { ready = await fetch('http://127.0.0.1:8787/api/health').then(r => r.ok).catch(() => false); if (ready) break; await setTimeout(1000); }
  if (!ready) throw new Error('The local API did not start. Check port 8787 and try pnpm api:dev.');
  await run(['scripts/run.mjs', 'tsx', 'scripts/seed.ts', '--local']);
  console.log('MelodyMeter will open at http://127.0.0.1:4321. No Cloudflare/Resend account is needed.');
  await run(['scripts/run.mjs', 'astro', 'dev', '--host', '127.0.0.1', '--port', '4321']);
} catch (error) { console.error(error.message); stop(); process.exit(1); }
