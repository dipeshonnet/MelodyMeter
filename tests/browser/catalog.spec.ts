import { test, expect } from '@playwright/test';
import { startStatic } from './static-server';
import { readFileSync } from 'node:fs';
import { starterSongs } from '../../data/starter';
import { emptyAudience, searchSongs, type Song } from '../../shared/rating';

const launchSongs: Song[] = JSON.parse(readFileSync('data/launch-catalog.json', 'utf8'));
const songs = launchSongs.length ? launchSongs : starterSongs;

test('catalog filters reuse cached ratings and DOM order, while live scores and recordings refresh', async ({ page }) => {
  const server = await startStatic();
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const audience = emptyAudience();
  audience.overall = { count: 10, score: 10, qualified: true };
  const extra = { ...songs[0], id: 'starter:catalog-regression', title: 'Unique catalog regression', ai: undefined };
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/saved-songs') { await route.fulfill({ status: 401, json: { code: 'sign_in_required' } }); return; }
    const json = url.pathname === '/api/audience-summary' ? { ratings: [{ id: songs[0].id, audience }] }
      : url.pathname === '/api/search' ? { songs: url.searchParams.get('q') === 'Unique catalog regression' ? [extra, extra] : [] }
      : { local: false };
    await route.fulfill({ json });
  });
  try {
    await page.goto(server.origin);
    const first = page.locator('.song-card').filter({ has: page.getByRole('heading', { name: songs[0].title, exact: true }) }).first();
    await expect(first.locator('[data-card-source]')).toHaveText('Community · 10 ratings');
    await page.locator('#song-sort').selectOption('easy');
    await expect(page.locator('.song-card').first().locator('.score-badge strong')).toHaveText('10.0');

    // Measure the actual hot path, without relying on machine-dependent timings.
    await page.evaluate(() => {
      const stats = { ratingReads: 0, cardMoves: 0 };
      (window as any).catalogStats = stats;
      const original = Storage.prototype.getItem;
      Storage.prototype.getItem = function(key) {
        if (key.startsWith('mm:rating:')) stats.ratingReads++;
        return original.call(this, key);
      };
      new MutationObserver(records => { stats.cardMoves += records.filter(record => record.type === 'childList').length; })
        .observe(document.querySelector('#song-grid')!, { childList: true });
    });
    const query = songs[0].artist;
    await page.locator('#song-search').fill(query);
    await expect(page.locator('.song-card:visible')).toHaveCount(searchSongs(songs, query).length);
    await page.locator('#song-search').fill('');
    await page.locator('#decade-filter').selectOption(String(Math.floor(songs.find(song => song.year)!.year! / 10) * 10));
    await page.locator('#decade-filter').selectOption('all');
    await page.getByRole('button', { name: 'Hindi', exact: true }).click();
    await expect(page.locator('.song-card:visible')).toHaveCount(songs.filter(song => song.language === 'Hindi').length);
    await page.getByRole('button', { name: 'All songs', exact: true }).click();
    expect(await page.evaluate(() => (window as any).catalogStats)).toEqual({ ratingReads: 0, cardMoves: 0 });

    // A summary changed in another tab must invalidate the cached score/order.
    await page.evaluate(({ id, audience }) => {
      localStorage.setItem('mm:summaries:v1', JSON.stringify({ [id]: audience }));
      window.dispatchEvent(new StorageEvent('storage', { key: 'mm:summaries:v1' }));
    }, { id: songs[0].id, audience: { ...audience, overall: { count: 11, score: 1, qualified: true } } });
    await expect(first.locator('.score-badge strong')).toHaveText('1.0');
    await page.locator('#song-sort').selectOption('hard');
    await expect(page.locator('.song-card').first().locator('h2')).toHaveText(songs[0].title);
    await page.locator('#song-sort').selectOption('featured');
    await expect(page.locator('.song-card').first().locator('h2')).toHaveText(songs[0].title);

    await page.locator('#song-search').fill(extra.title);
    await expect(page.locator('.song-card:visible')).toHaveCount(1);
    await page.getByRole('button', { name: `Save ${extra.title}`, exact: true }).click();
    await page.locator('#song-search').fill('');
    await page.locator('#saved-filter').click();
    await expect(page.locator('.song-card:visible h2')).toHaveText(extra.title);
    await expect(page.locator('#saved-count')).toHaveText('1');
    expect(errors).toEqual([]);
  } finally { await server.close(); }
});
