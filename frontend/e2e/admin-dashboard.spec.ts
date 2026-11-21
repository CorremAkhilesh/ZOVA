import { expect, test } from '@playwright/test';
import { open, SLOW, signUpByApi } from './helpers';

/** Admin → Dashboard on a desktop and on a phone, and a normal person kept out. */
test.describe.configure({ timeout: 120_000 });

test('an admin opens the panel: dashboard numbers, charts, storage and health', async ({
  page,
}, testInfo) => {
  // A fresh admin, made through the test API (the sign-in screens have their own tests).
  const email = await signUpByApi(page, 'Ada');
  await page.request.post('/v1/test/promote', { data: { email } });
  await open(page, '/admin');
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible(SLOW);
  await expect(page.getByText('Active today')).toBeVisible(SLOW);
  // The admin is signed in, so at least one person is active today.
  await expect(page.getByRole('figure', { name: /Active people/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Storage', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Health', exact: true })).toBeVisible();
  await expect(page.getByText('Database')).toBeVisible();

  await page.getByRole('button', { name: '30 days' }).click();
  await expect(page.getByRole('button', { name: '30 days' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  // Every section is one click away.
  const sections = page.getByRole('navigation', { name: 'Admin sections' });
  await sections.getByRole('link', { name: 'Users' }).click();
  await expect(page).toHaveURL(/\/admin\/users$/);
  await expect(page.getByRole('searchbox')).toBeVisible(SLOW);
  await sections.getByRole('link', { name: 'Audit log' }).click();
  await expect(page).toHaveURL(/\/admin\/audit$/);
  await sections.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible(SLOW);

  // No page wider than the screen, on a desktop or a phone.
  // (the page itself, and the column that scrolls inside it).
  const overflow = await page.evaluate(() =>
    Math.max(
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ...[...document.querySelectorAll('main .overflow-y-auto')].map(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ),
  );
  expect(overflow, testInfo.project.name).toBeLessThanOrEqual(1);
});

test('a normal person cannot open the admin panel', async ({ page }) => {
  await signUpByApi(page, 'Chetan');
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/settings$/, SLOW);
  await expect(page.getByRole('link', { name: /Admin panel/ })).toHaveCount(0);
  const response = await page.request.get('/v1/admin/dashboard');
  expect(response.status()).toBe(403);
});

test('the dashboard fits the screen with a full storage table', async ({ page }, testInfo) => {
  const email = await signUpByApi(page, 'Ada');
  await page.request.post('/v1/test/promote', { data: { email } });
  // A long table of the people storing most: on a phone it scrolls inside its own box.
  const real = await (await page.request.get('/v1/admin/dashboard')).json();
  const topUsers = Array.from({ length: 10 }, (_, index) => ({
    id: `u${index}`,
    email: `someone.with.a.long.name${index}@corremadvisory.com`,
    displayName: `Someone With A Long Name ${index}`,
    username: null,
    usedBytes: (index + 1) * 200_000_000,
    quotaBytes: 3 * 1024 ** 3,
  }));
  await page.route('**/v1/admin/dashboard', (route) =>
    route.fulfill({ json: { ...real, storage: { ...real.storage, topUsers } } }),
  );
  await open(page, '/admin');
  await expect(page.getByText('Someone With A Long Name 9')).toBeAttached(SLOW);
  const overflow = await page.evaluate(() =>
    Math.max(
      document.documentElement.scrollWidth - document.documentElement.clientWidth,
      ...[...document.querySelectorAll('main .overflow-y-auto')].map(
        (element) => element.scrollWidth - element.clientWidth,
      ),
    ),
  );
  expect(overflow, testInfo.project.name).toBeLessThanOrEqual(1);
});
