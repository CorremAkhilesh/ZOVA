import { type Browser, expect, type Page, test } from '@playwright/test';
import { open, SLOW, signUpByApi } from './helpers';

/** Admin → Users v2 on a desktop and on a phone: find, open, change, sign out, bulk and CSV. */
test.describe.configure({ timeout: 180_000 });

async function newPage(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}

async function makeAdmin(page: Page) {
  const email = await signUpByApi(page, 'Ada');
  await page.request.post('/v1/test/promote', { data: { email } });
  return email;
}

async function confirmWithReason(page: Page, button: string, reason: string) {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason').fill(reason);
  await dialog.getByRole('button', { name: button }).click(SLOW);
  await expect(dialog).toBeHidden(SLOW);
}

test('an admin finds a person, changes their limit and signs them out', async ({
  page,
  browser,
}) => {
  const person = await newPage(browser);
  const email = await signUpByApi(person, 'Bina');
  await makeAdmin(page);

  await open(page, '/admin/users');
  await page.getByRole('searchbox').fill(email);
  const row = page.getByRole('listitem').filter({ hasText: email });
  await expect(row).toBeVisible(SLOW);
  await row.getByRole('link', { name: 'Bina', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Bina', level: 1 })).toBeVisible(SLOW);
  await expect(page.getByRole('heading', { name: /device/ })).toBeVisible();

  // Storage limit: a preset, with a reason.
  await page.getByRole('button', { name: 'Change storage limit' }).click();
  await page.getByRole('dialog').getByRole('radio', { name: '5 GB' }).click();
  await confirmWithReason(page, 'Change storage limit', 'Design files');
  await expect(page.getByText('Their own limit, set by an admin.')).toBeVisible(SLOW);

  // Signed out everywhere: the person's open app goes back to the welcome screen.
  await page.getByRole('button', { name: 'Sign out of all devices' }).click();
  await confirmWithReason(page, 'Sign out of all devices', 'Lost phone');
  await expect(person.getByRole('heading', { name: /Welcome to/ })).toBeVisible({
    timeout: 30_000,
  });

  await open(page, '/admin/audit');
  await expect(page.getByText('Reason: “Lost phone”').first()).toBeVisible(SLOW);
});

test('bulk storage limit for two people, and the CSV download', async ({ page, browser }) => {
  const one = await newPage(browser);
  const two = await newPage(browser);
  const emails = [await signUpByApi(one, 'Chandra'), await signUpByApi(two, 'Chandra')];
  await makeAdmin(page);

  await open(page, '/admin/users');
  await page.getByRole('searchbox').fill('chandra');
  for (const email of emails) {
    // The label is the touch target (44 px), as a finger would use it.
    const item = page.getByRole('listitem').filter({ hasText: email });
    await item
      .locator('label')
      .filter({ has: page.getByRole('checkbox') })
      .click(SLOW);
    await expect(item.getByRole('checkbox')).toBeChecked();
  }
  await expect(page.getByText('2 selected')).toBeVisible();
  await page
    .getByRole('region', { name: 'Actions for the selected people' })
    .getByRole('button', { name: 'Change storage limit' })
    .click();
  await page.getByRole('dialog').getByRole('radio', { name: '10 GB' }).click();
  await confirmWithReason(page, 'Change storage limit', 'Video team');
  await expect(page.getByText('2 selected')).toBeHidden(SLOW);
  for (const email of emails) {
    await expect(page.getByRole('listitem').filter({ hasText: email })).toContainText(
      'of 10 GB',
      SLOW,
    );
  }

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^people-\d{4}-\d{2}-\d{2}\.csv$/);
  const text = (await (await file.createReadStream()).toArray()).join('');
  for (const email of emails) expect(text).toContain(email);
});

test('the users page fits the screen, with nothing cut off', async ({ page }, testInfo) => {
  await makeAdmin(page);
  await open(page, '/admin/users');
  await expect(page.getByRole('searchbox')).toBeVisible(SLOW);
  await expect(page.getByRole('listitem').first()).toBeVisible(SLOW);
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
