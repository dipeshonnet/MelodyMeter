import { test, expect } from '@playwright/test';
import { startStatic } from './static-server';

test('Google sign-in loads on request, preserves drafts, and waits for explicit submission', async ({ page }) => {
  const server = await startStatic();
  let scriptLoads = 0, votes = 0;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const data = path === '/api/auth/google/config' ? { enabled: true }
      : path === '/api/auth/google/start' ? { clientId: 'test.apps.googleusercontent.com', nonce: 'test-nonce' }
      : path === '/api/auth/google' ? { verified: true }
      : path === '/api/session' ? { verified: false }
      : path === '/api/health' ? { local: true, verificationConfigured: false }
      : path === '/api/audience' ? (votes++, { status: 'counted' }) : null;
    return route.fulfill({ status: data ? 200 : 503, contentType: 'application/json', body: JSON.stringify(data || { error: 'Test API unavailable' }) });
  });
  await page.route('https://accounts.google.com/gsi/client', route => {
    scriptLoads++;
    return route.fulfill({ contentType: 'application/javascript', body: `window.google={accounts:{id:{initialize(options){window.googleTestOptions=options},renderButton(container){const button=document.createElement('button');button.type='button';button.textContent='Continue with Google';button.onclick=()=>window.googleTestOptions.callback({credential:'mock-credential'});container.append(button)}}}};` });
  });
  try {
    await page.goto(`${server.origin}/song/?id=browser-test`);
    await expect(page.locator('#show-google-login')).toBeVisible();
    expect(scriptLoads).toBe(0);
    await page.getByRole('radio', { name: '8 out of 10', exact: true }).check({ force: true });
    await page.getByText('Rate individual factors (optional)', { exact: true }).click();
    await page.locator('#vote-range').selectOption('6');
    await page.locator('#show-google-login').click();
    await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toBeVisible();
    expect(scriptLoads).toBe(1);
    expect(votes).toBe(0);
    await expect(page.locator('input[name=overall]:checked')).toHaveValue('8');
    await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
    await expect(page.locator('#verified-session')).toBeVisible();
    await expect(page.locator('#email-field')).toBeHidden();
    await expect(page.locator('#vote-range')).toHaveValue('6');
    expect(votes).toBe(0);
    await page.getByRole('button', { name: 'Submit rating', exact: true }).click();
    await expect(page.locator('#vote-status')).toContainText('counted');
    expect(votes).toBe(1);
    expect(errors).toEqual([]);
  } finally { await server.close(); }
});

test('blocked Google script leaves email and score draft available', async ({ page }) => {
  const server = await startStatic();
  await page.route('**/api/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(new URL(route.request().url()).pathname === '/api/auth/google/config' ? { enabled: true } : { local: true, verificationConfigured: true, verified: false }) }));
  await page.route('https://accounts.google.com/gsi/client', route => route.abort());
  try {
    await page.goto(`${server.origin}/song/?id=browser-test`);
    await page.getByRole('radio', { name: '7 out of 10', exact: true }).check({ force: true });
    await page.locator('#show-google-login').click();
    await expect(page.locator('#vote-status')).toContainText('could not load');
    await expect(page.locator('#email-field')).toBeVisible();
    await expect(page.locator('input[name=overall]:checked')).toHaveValue('7');
    await expect(page.locator('#show-google-login')).toBeEnabled();
  } finally { await server.close(); }
});
