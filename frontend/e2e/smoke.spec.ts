import { expect, test } from '@playwright/test';
import { signUp } from './helpers';

test('signed-in app loads, switches theme and opens Saved Messages', async ({ page }) => {
  await signUp(page);
  await expect(page.getByRole('heading', { name: 'Chats', exact: true })).toBeVisible();

  // Theme: dark, persisted across a reload without a flash.
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('radio', { name: 'Dark' }).click();
  // Development only: not in this production build.
  await expect(page.getByRole('heading', { name: 'About', exact: true })).toHaveCount(0);
  await expect(page.locator('summary')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // Open a chat and use the composer with real clicks and typing.
  await page.getByRole('link', { name: 'Chats', exact: true }).click();
  await page.getByRole('link', { name: /Saved Messages/ }).click();
  await expect(page).toHaveURL(/\/chats\/[0-9a-f]{24}$/);
  await page.getByRole('textbox', { name: 'Write a message' }).fill('Hello from Playwright');
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
});
