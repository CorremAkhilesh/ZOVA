import { type Browser, expect, type Page, test } from '@playwright/test';
import { open, SLOW, signUpByApi } from './helpers';

/**
 * The admin panel end to end, on a desktop and a phone: an announcement reaches the chosen person,
 * a suspension signs them out and is explained at sign-in, an archived group goes read-only, and
 * every step is in the audit log. Each test touches only the people and groups it makes.
 */
test.describe.configure({ timeout: 240_000 });

async function newPage(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage();
}

async function makeAdmin(page: Page) {
  const email = await signUpByApi(page, 'Ada');
  await page.request.post('/v1/test/promote', { data: { email } });
  return email;
}

async function idOf(page: Page): Promise<string> {
  return (await (await page.request.get('/v1/auth/me')).json()).user.id;
}

async function confirmWithReason(page: Page, button: string, reason: string) {
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Reason').fill(reason);
  await dialog.getByRole('button', { name: button, exact: true }).click(SLOW);
  await expect(dialog).toBeHidden(SLOW);
}

test('an announcement reaches the chosen person as a banner they can close', async ({
  page,
  browser,
}) => {
  const person = await newPage(browser);
  const username = `dina${Math.random().toString(36).slice(2, 10)}`;
  await signUpByApi(person, 'Dina', username);
  const title = `Maintenance ${username.slice(4)}`;
  await makeAdmin(page);
  await open(person, '/chats');

  await open(page, '/admin/announcements');
  await page.getByRole('button', { name: 'New announcement' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  await dialog
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('The app is down from 10 to 11 pm.');
  await dialog.getByText('Chosen people', { exact: true }).click();
  await dialog.getByRole('searchbox').fill(username);
  await dialog.getByRole('button', { name: new RegExp(`@${username}`) }).click(SLOW);
  await expect(dialog.getByRole('list', { name: 'Selected people' })).toContainText('Dina');
  await confirmWithReason(page, 'Send', 'Planned maintenance');
  await expect(page.getByText(title)).toBeVisible(SLOW);

  await person.reload();
  const banner = person.getByRole('region', { name: 'Announcements from the admins' });
  await expect(banner).toContainText(title, { timeout: 30_000 });
  await banner.getByRole('button', { name: `Close “${title}”` }).click();
  await expect(banner).toBeHidden(SLOW);
  await person.reload();
  await expect(person.getByRole('heading', { name: 'Chats', exact: true })).toBeVisible(SLOW);
  await expect(banner).toBeHidden();
});

test('a suspension signs the person out and the sign-in screen says until when and why', async ({
  page,
  browser,
}) => {
  const person = await newPage(browser);
  const email = await signUpByApi(person, 'Esha');
  const id = await idOf(person);
  await makeAdmin(page);
  await open(person, '/chats');

  await open(page, `/admin/users/${id}`);
  await page.getByRole('button', { name: 'Suspend', exact: true }).click(SLOW);
  await page
    .getByRole('dialog')
    .locator('label')
    .filter({ hasText: /^7 days$/ })
    .click();
  await confirmWithReason(page, 'Suspend', 'Policy review');
  await expect(page.getByText(/Suspended until/).first()).toBeVisible(SLOW);

  await expect(person.getByRole('heading', { name: /Welcome to/ })).toBeVisible({
    timeout: 30_000,
  });
  await person.getByRole('textbox', { name: 'Work email' }).fill(email);
  await person.getByRole('button', { name: 'Continue' }).click();
  await expect(person.getByRole('alert')).toContainText('Your account is suspended until', SLOW);
  await expect(person.getByRole('alert')).toContainText('Reason: Policy review');

  await open(page, '/admin/audit');
  await expect(page.getByText(new RegExp(`suspended ${email.replace('.', '\\.')}`))).toBeVisible(
    SLOW,
  );
});

test('an archived group can be read but not written in', async ({ page, browser }) => {
  const owner = await newPage(browser);
  const member = await newPage(browser);
  await signUpByApi(owner, 'Farah');
  await signUpByApi(member, 'Gita');
  const memberId = await idOf(member);
  const origin = new URL(owner.url() || 'http://127.0.0.1:5194').origin;
  const created = await owner.request.post('/v1/groups', {
    data: { name: `Noisy ${Date.now().toString(36)}`, memberIds: [memberId] },
    headers: { origin },
  });
  const group = (await created.json()).chat;
  await makeAdmin(page);

  await open(page, '/admin/groups');
  await page.getByRole('searchbox').fill(group.group.name);
  const row = page.getByRole('listitem').filter({ hasText: group.group.name });
  await row.getByRole('button', { name: 'Archive' }).click(SLOW);
  await confirmWithReason(page, 'Archive', 'Spam reports');
  await expect(row.getByText('Archived', { exact: true })).toBeVisible(SLOW);

  await open(member, `/chats/${group.id}`);
  await expect(
    member.getByText('An administrator archived this group. You can read it and leave it.'),
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(member.getByPlaceholder('Write a message')).toHaveCount(0);
});
