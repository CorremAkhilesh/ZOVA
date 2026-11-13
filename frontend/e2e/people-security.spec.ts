import { type Browser, expect, type Page, test } from '@playwright/test';
import { open, SLOW, signIn, signUp } from './helpers';

// A 96×96 PNG: the crop dialog re-encodes it, the server makes the 512/128 px WebP versions.
const PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAIAAABt+uBvAAAACXBIWXMAAAPoAAAD6AG1e1JrAAABCElEQVR4nO3ZsQ3DMADEQE+X1vsPwD0yQdIYxqs4QBMQfEaKr/uTc/+GcKFz/1UEoADqyUoYFEAxqPd+akwsgGJQJtbqQqtBARSDMrE0qDP/VxDpAIpBmVga1LzHIh1AMSgTa94dF8UAikGZWPMAeawGUAzKxNKg5jEW6QCKQZlY8+i4KAZQDMrEOuT4shpAMSgTS4Oa91ikAygGZWLNu+OiGEAxKBNrHiCP1QCKQZlYGtQ8xiIdQDEoE2seHRfFAIpBmViHHF9WAygGZWJpUPMei3QAxaBMrHl3XBQDKAZlYs0D5LEaQDEoE0uDmsdYpAMoBmVizaPjohhAMSgT65Djy2oA9cSgL6MVKxyEC7yFAAAAAElFTkSuQmCC',
  'base64',
);

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

/** A long single test ran out of time in slower browsers: each flow stands alone now. */
test.describe.configure({ timeout: 120_000 });

test('profile photo and username, and finding a colleague', async ({ browser }) => {
  // CI Firefox sometimes needs more than 2 minutes for this flow; the steps say where it waits.
  test.setTimeout(180_000);
  const a = await newPage(browser);
  const b = await newPage(browser);

  // A chooses a username on the first-login screen, then adds a profile photo.
  const username = `asha${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 6)}`;
  await test.step('both sign up', async () => {
    await signUp(a, 'Asha Verma', username);
    await signUp(b, 'Bharat Rao');
  });

  await test.step('A sees the username, locked for 30 days', async () => {
    await open(a, '/settings/profile');
    await expect(a.getByText(`@${username}`)).toBeVisible(SLOW);
    // Just chosen, so it can't change again for 30 days.
    await expect(a.getByRole('button', { name: 'Edit Username' })).toBeDisabled();
  });

  await test.step('A adds a profile photo', async () => {
    await a.locator('input[type=file]').setInputFiles({
      name: 'me.png',
      mimeType: 'image/png',
      buffer: PHOTO,
    });
    const crop = a.getByRole('dialog', { name: 'Adjust your photo' });
    await expect(crop.getByRole('button', { name: 'Use photo' })).toBeEnabled(SLOW);
    await crop.getByRole('button', { name: 'Use photo' }).click();
    await expect(a.getByRole('button', { name: 'Remove photo' })).toBeVisible(SLOW);
  });

  // B: finds A in the people picker, the chat opens, and its info shows A's @username.
  await test.step('B finds A in the people picker', async () => {
    await open(b, '/chats');
    await b.getByRole('button', { name: 'New chat' }).click();
    const picker = b.getByRole('dialog', { name: 'New chat' });
    await picker.getByRole('combobox').fill(username);
    // Search results (not the suggestions shown before typing) contain exactly A.
    await expect(picker.getByRole('listbox', { name: 'People' })).toBeVisible(SLOW);
    await expect(picker.getByRole('option')).toHaveCount(1, SLOW);
    await expect(picker.getByRole('option', { name: /Asha Verma/ })).toBeVisible();
    await picker.getByRole('combobox').press('Enter');
    await expect(b.getByRole('heading', { name: 'Asha Verma' })).toBeAttached(SLOW);
  });

  await test.step('chat info shows the username', async () => {
    await b.getByRole('button', { name: 'Chat info' }).first().click();
    await expect(b.getByText(`@${username}`).first()).toBeVisible(SLOW);
  });
});

test('signing out another device from Devices', async ({ browser }) => {
  const a = await newPage(browser);
  const emailA = await signUp(a, 'Asha Verma');
  const a2 = await newPage(browser);
  await signIn(a2, emailA);
  await open(a, '/settings/devices');
  await expect(a.getByText('This device')).toBeVisible(SLOW);
  await a.getByRole('button', { name: 'Sign out all other devices' }).click(SLOW);
  await a
    .getByRole('dialog')
    .getByRole('button', { name: 'Sign out all other devices' })
    .click(SLOW);
  await expect(a.getByText('You’re only signed in on this device.')).toBeVisible(SLOW);
  await expect(a2.getByRole('heading', { name: /Welcome to/ })).toBeVisible({ timeout: 30_000 });
});

test('an admin deactivates someone, who is signed out, and it is audited', async ({ browser }) => {
  const b = await newPage(browser);
  const admin = await newPage(browser);
  const emailB = await signUp(b, 'Bharat Rao');
  const adminEmail = await signUp(admin, 'Ada Admin');
  await admin.request.post('/v1/test/promote', { data: { email: adminEmail } });
  await open(admin, '/settings/admin/users');
  await admin.getByRole('searchbox').fill(emailB);
  const row = admin.getByRole('listitem').filter({ hasText: emailB });
  await row.getByRole('button', { name: 'Deactivate' }).click(SLOW);
  await admin.getByRole('dialog').getByRole('button', { name: 'Deactivate' }).click(SLOW);
  await expect(row.getByText('Deactivated')).toBeVisible(SLOW);
  await expect(b.getByRole('heading', { name: /Welcome to/ })).toBeVisible({ timeout: 30_000 });

  // Every admin action is in the audit log.
  await open(admin, '/settings/admin/audit');
  await expect(admin.getByText(`${adminEmail} deactivated ${emailB}`)).toBeVisible(SLOW);
});
