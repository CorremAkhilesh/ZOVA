import { expect, test } from '@playwright/test';

test('app loads, switches theme and opens a mock chat', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Welcome to/ })).toBeVisible();

  // Into the design preview.
  await page.getByRole('link', { name: /Open the design preview/ }).click();
  await expect(page).toHaveURL(/\/chats$/);
  await expect(page.getByRole('heading', { name: 'Chats' })).toBeVisible();

  // Theme: dark, persisted across a reload without a flash.
  await page.getByRole('link', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // Open a chat and use the composer with real clicks and typing.
  await page.getByRole('link', { name: 'Chats' }).click();
  await page.getByRole('link', { name: /Asha Verma/ }).click();
  await expect(page).toHaveURL(/\/chats\/asha$/);
  await expect(page.getByRole('list', { name: 'Asha Verma' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Write a message' }).fill('Hello from Playwright');
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible();
});
