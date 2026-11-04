import { expect, type Page, test } from '@playwright/test';

// Service-worker control in Playwright is Chromium-only; the other engines run the smoke test.
test.skip(({ browserName }) => browserName !== 'chromium', 'Service worker checks need Chromium');

async function waitForActiveServiceWorker(page: Page) {
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) =>
        navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), {
          once: true,
        }),
      );
    }
    return registration.active?.state;
  });
}

test('manifest is valid and installable', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);
  const manifest = await response.json();
  expect(manifest).toMatchObject({
    id: '/',
    start_url: '/chats',
    scope: '/',
    display: 'standalone',
    display_override: ['window-controls-overlay', 'standalone'],
  });
  expect(manifest.name).toBeTruthy();
  expect(manifest.short_name).toBeTruthy();
  const sizes = manifest.icons.map(
    (icon: { sizes: string; purpose: string }) => `${icon.sizes}:${icon.purpose}`,
  );
  expect(sizes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']));
  for (const icon of manifest.icons as Array<{ src: string }>) {
    expect((await request.get(icon.src)).ok()).toBe(true);
  }
  expect(manifest.screenshots.map((s: { form_factor: string }) => s.form_factor)).toEqual([
    'wide',
    'narrow',
  ]);
});

test('service worker registers and controls the page', async ({ page }) => {
  await page.goto('/');
  await waitForActiveServiceWorker(page);
  const state = await page.evaluate(() => navigator.serviceWorker.controller?.state);
  expect(state).toBe('activated');
});

test('app shell loads offline', async ({ page, context }) => {
  await page.goto('/chats');
  await waitForActiveServiceWorker(page);
  await context.setOffline(true);
  await page.goto('/chats/asha');
  await expect(page.getByRole('list', { name: 'Asha Verma' })).toBeVisible();
  // Reloading the same deep link offline must work too (on phones this URL shows only the chat).
  await page.reload();
  await expect(page.getByRole('list', { name: 'Asha Verma' })).toBeVisible();
  await context.setOffline(false);
});

test('/v1 requests are never served from the service worker cache', async ({ page, context }) => {
  const fromServiceWorker: string[] = [];
  page.on('response', (response) => {
    if (new URL(response.url()).pathname.startsWith('/v1/') && response.fromServiceWorker()) {
      fromServiceWorker.push(response.url());
    }
  });

  await page.goto('/chats');
  await waitForActiveServiceWorker(page);
  await page.reload();
  await page.evaluate(() => fetch('/v1/health').catch(() => null));

  // Nothing under /v1 is ever stored in any cache…
  const cachedApiUrls = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) urls.push(new URL(request.url).pathname);
    }
    return urls.filter((path) => path.startsWith('/v1'));
  });
  expect(cachedApiUrls).toEqual([]);
  expect(fromServiceWorker).toEqual([]);

  // …so offline, API calls fail instead of returning stale data.
  await context.setOffline(true);
  const offlineResult = await page.evaluate(() =>
    fetch('/v1/health')
      .then((r) => `status ${r.status}`)
      .catch(() => 'network error'),
  );
  expect(offlineResult).toBe('network error');
  await context.setOffline(false);
});
