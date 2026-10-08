import { test, expect } from '@playwright/test';
import { startStatic } from './static-server';
test('search, filters, ease sorting, bookmarks, and responsive layout', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.song-card:visible')).toHaveCount(32);
  await page.getByRole('button', { name: 'Hindi', exact: true }).click();
  await expect(page.locator('.song-card:visible')).toHaveCount(16);
  await page.getByRole('button', { name: 'All songs', exact: true }).click();
  await page.getByLabel('Search song, artist, or film').fill('Queen');
  await expect(page.locator('.song-card:visible')).toHaveCount(1);
  await expect(page.locator('.song-card:visible h2')).toHaveText('Bohemian Rhapsody');
  await page.getByRole('button', { name: 'Save Bohemian Rhapsody', exact: true }).click();
  await expect(page.locator('#saved-count')).toHaveText('1');
  await page.getByLabel('Search song, artist, or film').fill('');
  await page.locator('#saved-filter').click();
  await expect(page.locator('.song-card:visible')).toHaveCount(1);
  await page.reload(); await page.locator('#saved-filter').click();
  await expect(page.locator('.song-card:visible')).toHaveCount(1);
  await page.getByRole('button', { name: 'All songs', exact: true }).click();
  await page.getByLabel('Filter by ease', { exact: true }).selectOption('easy');
  await page.getByLabel('Sort songs').selectOption('easy');
  expect(await page.locator('.song-card:visible .score-badge strong').allTextContents()).not.toContain('3');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
test('email preview requires an explicit confirmation; verified updates count one voter', async ({ page, context }) => {
  await page.goto('/songs/bohemian-rhapsody/');
  await expect(page.locator('#primary-score strong')).toHaveText('3');
  await expect(page.locator('input[name=overall]:checked')).toHaveCount(0);
  await page.getByRole('radio', { name: '8 out of 10', exact: true }).check({ force: true });
  await page.getByText('Rate individual factors (optional)', { exact: true }).click();
  await page.locator('#vote-range').selectOption('6');
  const email = `browser-${crypto.randomUUID()}@example.org`;
  await page.getByLabel('Email address', { exact: true }).fill(email);
  const before = await (await context.request.get('/api/ratings/starter%3Abohemian-rhapsody')).json();
  await page.getByRole('button', { name: 'Verify & submit rating', exact: true }).click();
  await expect(page.locator('#vote-status')).toContainText('No email was sent');
  const messages = await (await context.request.get('/api/dev/mail')).json();
  const url = messages.messages[0].url;
  await page.goto(url);
  await expect(page.getByRole('button', { name: 'Confirm rating', exact: true })).toBeVisible();
  const pending = await (await context.request.get('/api/ratings/starter%3Abohemian-rhapsody')).json();
  expect(pending.audience.overall.count).toBe(before.audience.overall.count);
  await page.getByRole('button', { name: 'Confirm rating', exact: true }).click();
  await expect(page.locator('#verification-preview')).toContainText('counted');
  const counted = await (await context.request.get('/api/ratings/starter%3Abohemian-rhapsody')).json();
  expect(counted.audience.overall.count).toBe(before.audience.overall.count + 1);
  await page.goto('/songs/bohemian-rhapsody/');
  await expect(page.locator('#verified-session')).toBeVisible();
  await expect(page.getByRole('radio', { name: '8 out of 10', exact: true })).toBeChecked();
  await page.getByRole('radio', { name: '5 out of 10', exact: true }).check({ force: true });
  await page.getByText('Rate individual factors (optional)', { exact: true }).click();
  await page.locator('#vote-range').selectOption('');
  await page.getByRole('button', { name: /Update my rating|Submit rating/ }).click();
  await expect(page.locator('#vote-status')).toContainText('counted');
  const updated = await (await context.request.get('/api/ratings/starter%3Abohemian-rhapsody')).json();
  expect(updated.audience.overall.count).toBe(counted.audience.overall.count);
  expect(updated.audience.factors.range.count).toBe(before.audience.factors.range.count);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
test('production PWA caches saved pages and excludes private routes and APIs', async ({ page, context, browserName }) => {
  // Playwright 1.63 WebKit rejects SW navigation under setOffline even for literal
  // responses: https://github.com/microsoft/playwright/issues/42775.
  // Stop an isolated origin instead; no app code or cache response is mocked.
  const isolated = browserName === 'webkit' ? await startStatic() : null;
  const origin = isolated?.origin || 'http://127.0.0.1:4322';
  try {
  await page.goto(`${origin}/`);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.getByRole('button', { name: 'Save Bohemian Rhapsody', exact: true }).click();
  await expect.poll(() => page.evaluate(async () => !!(await caches.match('/songs/bohemian-rhapsody/')))).toBe(true);
  await page.goto(`${origin}/songs/bohemian-rhapsody/`);
  await expect(page.locator('#primary-score strong')).toHaveText('3');
  await page.screenshot({ path: `artifacts/${test.info().project.name}-detail.png`, fullPage: true });
  if (isolated) {
    await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }));
    await isolated.close();
  } else await context.setOffline(true);
  await page.reload();
  await expect(page.locator('h1')).toHaveText('Bohemian Rhapsody');
  await expect(page.locator('#primary-score strong')).toHaveText('3');
  await expect(page.locator('#connection-notice')).toBeVisible();
  await page.goto(`${origin}/?saved=1`);
  await expect(page.locator('.song-card:visible')).toHaveCount(1);
  const keys = await page.evaluate(async () => { const names = await caches.keys(); return (await (await caches.open(names.find(name => name.startsWith('melodymeter-public-'))!)).keys()).map(r => new URL(r.url).pathname); });
  expect(keys.some(key => key.startsWith('/api/') || key.startsWith('/verify') || key.startsWith('/dev-mail'))).toBe(false);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (!isolated) await context.setOffline(false);
  } finally { await isolated?.close(); }
});
test('sharing fallback, installation manifest, and accessibility labels are available', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await page.addInitScript(() => { Object.defineProperty(navigator, 'share', { value: undefined, configurable: true }); Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (text: string) => { (window as any).__sharedURL = text; } }, configurable: true }); });
  await page.goto('/songs/stand-by-me/');
  await page.getByRole('button', { name: 'Share song', exact: true }).click();
  await expect(page.locator('#toast')).toHaveText('Song link copied');
  expect(await page.evaluate(() => (window as any).__sharedURL)).toContain('/songs/stand-by-me/');
  const manifest = await (await context.request.get('/manifest.webmanifest')).json();
  expect(manifest.display).toBe('standalone'); expect(manifest.icons.some((icon: any) => icon.sizes === '512x512')).toBe(true);
  await page.evaluate(() => { const event = new Event('beforeinstallprompt'); Object.assign(event, { prompt: async () => {}, userChoice: Promise.resolve({ outcome: 'accepted' }) }); window.dispatchEvent(event); });
  await expect(page.locator('#install-app')).toBeVisible(); await page.locator('#install-app').click();
  await expect(page.locator('#install-app')).toBeHidden();
});
