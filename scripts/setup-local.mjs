import { existsSync, copyFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (!existsSync('worker/.dev.vars')) writeFileSync('worker/.dev.vars', `DEV_MODE=true\nAPP_ORIGIN=http://127.0.0.1:4321\nEMAIL_HMAC_SECRET=${randomBytes(32).toString('hex')}\nMUSICBRAINZ_CONTACT=https://melody.everydayai.work\n`);
if (!existsSync('.env')) copyFileSync('.env.example', '.env');
console.log('Local configuration ready. Verification emails stay in the local test inbox.');
