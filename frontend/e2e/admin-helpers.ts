import { expect, type Page } from '@playwright/test';
import { quietNotificationNudge, readOtp, SLOW } from './helpers';

/** The E2E server's admin (ADMIN_EMAILS). Several tests and browsers may sign in at once. */
export const ADMIN = 'e2e.admin@corremadvisory.com';

export async function signInAdmin(page: Page) {
  await quietNotificationNudge(page);
  await page.request.post('/v1/test/reset-otp-limits', { data: { email: ADMIN } });
  const before = await page.request
    .get(`/v1/test/outbox/latest?to=${encodeURIComponent(ADMIN)}`)
    .then(async (response) => (response.ok() ? (await response.json()).subject : ''));
  await page.goto('/');
  await page.getByRole('textbox', { name: 'Work email' }).fill(ADMIN);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible(SLOW);
  await page
    .getByRole('textbox', { name: 'Digit 1 of 6' })
    .fill(await readOtp(page, ADMIN, before));
  // The first sign-in ever also asks for a name.
  const named = page.getByRole('heading', { name: 'What should we call you?' });
  await expect(named.or(page.getByRole('heading', { name: 'Chats' }))).toBeVisible(SLOW);
  if (await named.isVisible()) {
    await page.getByRole('textbox', { name: 'Your name' }).fill('E2E Admin');
    await expect(page.getByRole('textbox', { name: 'Username' })).not.toHaveValue('', SLOW);
    await expect(page.getByText('Available', { exact: true })).toBeVisible(SLOW);
    await page.getByRole('button', { name: 'Continue' }).click();
  }
  await expect(page).toHaveURL(/\/chats$/, SLOW);
}
