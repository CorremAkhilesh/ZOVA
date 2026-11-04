import { expect, test } from '@playwright/test';
import { signUp } from './helpers';

test('sign up with an organization email, stay signed in after reload, then sign out', async ({
  page,
}) => {
  await signUp(page, 'Playwright User');
  await expect(page.getByRole('heading', { name: 'Chats' })).toBeVisible();

  // The session survives a reload (httpOnly cookie, restored via /v1/auth/me).
  await page.reload();
  await expect(page).toHaveURL(/\/chats$/);
  await expect(page.getByRole('heading', { name: 'Chats' })).toBeVisible();

  // Settings → Account shows the user and signs out.
  await page.goto('/settings');
  await expect(page.getByText('Playwright User').first()).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: /Welcome to/ })).toBeVisible();

  // Signed out for real: the app is no longer reachable.
  await page.goto('/chats');
  await expect(page).toHaveURL(/\/$/);
});

test('a disallowed domain is rejected', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Work email' }).fill('someone@gmail.com');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('alert')).toHaveText(
    'Only @corremadvisory.com email addresses can use Zuvo',
  );
  await expect(page).toHaveURL(/\/$/);

  // The server refuses it too (the browser check is only for convenience).
  const response = await page.request.post('/v1/auth/otp/request', {
    data: { email: 'user@corremadvisory.com.evil.com' },
    headers: { origin: new URL(page.url()).origin },
  });
  expect(response.status()).toBe(403);
  expect((await response.json()).message).toBe(
    'Only @corremadvisory.com email addresses can use Zuvo',
  );
});
