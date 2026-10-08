import { test, expect } from '@playwright/test';
import { startStatic } from './static-server';
import { readFileSync } from 'node:fs';
import type { Song } from '../../shared/rating';
const songs: Song[] = JSON.parse(readFileSync('data/launch-catalog.json', 'utf8'));

test('device bookmarks migrate, fresh devices restore, offline removals sync, and accounts stay separate', async ({ page, browser }) => {
  const server = await startStatic();
  const accounts: Record<string, Set<string>> = { ['a'.repeat(64)]: new Set(), ['b'.repeat(64)]: new Set() };
  let account = 'a'.repeat(64);
  let failWrites = false;
  const postedAccounts: string[] = [];
  const setup = async (target: typeof page) => {
    await target.route('**/api/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === '/api/saved-songs') {
        if (request.method() === 'POST') {
          if (failWrites) { await route.abort(); return; }
          const input = request.postDataJSON();
          if (input.account !== account) { await route.fulfill({ status: 409, json: { code: 'account_changed' } }); return; }
          postedAccounts.push(input.account);
          for (const change of input.changes) {
            if (change.saved) accounts[account].add(change.songId); else accounts[account].delete(change.songId);
          }
          await route.fulfill({ json: { synced: true } }); return;
        }
        await route.fulfill({ json: { account, songs: songs.filter(song => accounts[account].has(song.id)) } }); return;
      }
      await route.fulfill({ json: path === '/api/audience-summary' ? { ratings: [] } : { local: true } });
    });
  };
  const id = songs[0].id;
  const guestId = songs[1].id;
  let freshContext: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  try {
    await setup(page);
    await page.addInitScript(guestId => {
      if (!localStorage.getItem('test:initialized')) {
        localStorage.setItem('mm:favorites:v1', JSON.stringify([guestId]));
        localStorage.setItem('test:initialized', 'true');
      }
    }, guestId);
    await page.goto(`${server.origin}/?saved=1`);
    await expect.poll(() => accounts[account].has(guestId)).toBe(true);
    await expect(page.locator('#saved-count')).toHaveText('1');
    await page.getByRole('button', { name: 'All songs', exact: true }).click();
    await page.getByRole('button', { name: `Save ${songs[0].title}`, exact: true }).click();
    await expect.poll(() => accounts[account].has(id)).toBe(true);
    await expect(page.locator('#saved-count')).toHaveText('2');

    freshContext = await browser.newContext();
    const fresh = await freshContext.newPage();
    await setup(fresh);
    await fresh.goto(`${server.origin}/?saved=1`);
    await expect(fresh.locator('.song-card:visible')).toHaveCount(2);
    await expect(fresh.getByRole('button', { name: `Unsave ${songs[0].title}`, exact: true })).toHaveAttribute('aria-pressed', 'true');

    failWrites = true;
    await fresh.getByRole('button', { name: `Unsave ${songs[0].title}`, exact: true }).click();
    await expect(fresh.locator('#saved-count')).toHaveText('1');
    await expect.poll(() => fresh.evaluate(({ account, id }) => JSON.parse(localStorage.getItem(`mm:favorites:pending:${account}`) || '{}')[id], { account, id })).toBe(false);
    expect(accounts[account].has(id)).toBe(true);
    failWrites = false;
    await fresh.reload();
    await expect.poll(() => accounts[account].has(id)).toBe(false);
    await expect(fresh.locator('#saved-count')).toHaveText('1');

    // A failed operation belongs to the old account, even if the cookie changes.
    failWrites = true;
    await fresh.getByRole('button', { name: `Unsave ${songs[1].title}`, exact: true }).click();
    await expect(fresh.locator('#saved-count')).toHaveText('0');
    account = 'b'.repeat(64); failWrites = false;
    await fresh.reload();
    await expect.poll(() => fresh.evaluate(() => JSON.parse(localStorage.getItem('mm:favorites:account') || 'null'))).toBe(account);
    await expect(fresh.locator('#saved-count')).toHaveText('0');
    expect(accounts['a'.repeat(64)].has(guestId)).toBe(true);
    expect(postedAccounts).not.toContain(account);
    account = 'a'.repeat(64);
    await fresh.reload();
    await expect.poll(() => accounts[account].size).toBe(0);
  } finally { await freshContext?.close(); await server.close(); }
});
