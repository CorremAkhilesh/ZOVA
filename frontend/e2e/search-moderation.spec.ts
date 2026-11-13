import { expect, type Page, test } from '@playwright/test';
import { newPerson, openChatWith, openFromList, send, thread } from './chat-helpers';
import { readOtp, SLOW } from './helpers';

test.describe.configure({ timeout: 300_000 });
// Something stuck should fail with a reason, and not use up the whole job.
test.use({ actionTimeout: 30_000 });

/** The E2E server's admin (ADMIN_EMAILS). Several tests and browsers may sign in at once. */
const ADMIN = 'e2e.admin@corremadvisory.com';

async function signInAdmin(page: Page) {
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
    await expect(page.getByText('Available')).toBeVisible(SLOW);
    await page.getByRole('button', { name: 'Continue' }).click();
  }
  await expect(page).toHaveURL(/\/chats$/, SLOW);
}

async function chatMenu(page: Page, name: string) {
  await page.getByRole('link', { name: new RegExp(name) }).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: `Actions for ${name}` });
  await expect(menu).toBeVisible();
  return menu;
}

test('A searches a word and opens the result in the right chat', async ({ browser }) => {
  const asha = await newPerson(browser, 'Asha');
  const bharat = await newPerson(browser, 'Bharat');
  const chitra = await newPerson(browser, 'Chitra');
  const word = `zebra${Date.now().toString(36)}`;
  await openChatWith(asha.page, chitra);
  await send(asha.page, 'nothing to see here');
  // On a phone the open chat covers the list, and with it the New chat button.
  await asha.page.goto('/chats');
  await openChatWith(asha.page, bharat);
  await send(asha.page, `the ${word} plan is ready`);
  await asha.page.goto('/chats');

  // The chat list's search box hands over to message search.
  await asha.page.getByRole('searchbox', { name: 'Search chats' }).fill(word);
  await asha.page.getByRole('button', { name: `Search messages for “${word}”` }).click();
  const messages = asha.page.getByRole('group', { name: 'Messages' });
  await expect(messages).toContainText(`the ${word} plan is ready`, SLOW);
  await messages.getByRole('option').first().click();
  await expect(asha.page).toHaveURL(/\/chats\/[0-9a-f]{24}$/, SLOW);
  await expect(thread(asha.page, 'Bharat').getByText(`the ${word} plan is ready`)).toBeVisible(
    SLOW,
  );

  for (const person of [asha, bharat, chitra]) await person.context.close();
});

test('a formatted message renders for the other person', async ({ browser }) => {
  const asha = await newPerson(browser, 'Asha');
  const bharat = await newPerson(browser, 'Bharat');
  await openChatWith(asha.page, bharat);
  await send(asha.page, 'this is *important* and `npm run build`');
  await openFromList(bharat.page, 'Asha');
  const conversation = thread(bharat.page, 'Asha');
  await expect(conversation.locator('strong', { hasText: 'important' })).toBeVisible(SLOW);
  await expect(conversation.locator('code', { hasText: 'npm run build' })).toBeVisible();
  await expect(conversation.getByText('*important*')).toHaveCount(0);
  await asha.context.close();
  await bharat.context.close();
});

test('A sends a link with a preview, and B sees the card', async ({ browser }) => {
  const asha = await newPerson(browser, 'Asha');
  const bharat = await newPerson(browser, 'Bharat');
  const { url } = await (await asha.page.request.get('/v1/test/preview-site')).json();
  await openChatWith(asha.page, bharat);
  await asha.page.getByRole('textbox', { name: 'Write a message' }).fill(`read this ${url}`);
  const attached = asha.page.getByRole('region', { name: 'Link preview' });
  await expect(attached).toContainText('Quarterly results are in', SLOW);
  await asha.page.getByRole('button', { name: 'Send' }).click();
  await openFromList(bharat.page, 'Asha');
  const card = thread(bharat.page, 'Asha').getByRole('link', {
    name: /Quarterly results are in on E2E News/,
  });
  await expect(card).toBeVisible(SLOW);
  // The picture comes from our API, never from the site.
  await expect(card.locator('img')).toHaveAttribute('src', /^\/v1\/link-previews\/images\//);
  await asha.context.close();
  await bharat.context.close();
});

test('B blocks A, and A can no longer send', async ({ browser, isMobile }) => {
  test.skip(isMobile, 'Right click is a desktop gesture; blocking from a profile has unit tests.');
  const asha = await newPerson(browser, 'Asha');
  const bharat = await newPerson(browser, 'Bharat');
  await openChatWith(asha.page, bharat);
  await send(asha.page, 'hello there');
  await openFromList(bharat.page, 'Asha');
  await expect(thread(bharat.page, 'Asha').getByText('hello there')).toBeVisible(SLOW);

  await (await chatMenu(bharat.page, 'Asha')).getByRole('menuitem', { name: /^Block/ }).click();
  await bharat.page.getByRole('dialog').getByRole('button', { name: 'Block' }).click();
  await expect(bharat.page.getByRole('button', { name: /You blocked this contact/ })).toBeVisible(
    SLOW,
  );

  await send(asha.page, 'are you there?');
  await expect(asha.page.getByText('Not sent — tap to retry')).toBeVisible(SLOW);
  await expect(thread(bharat.page, 'Asha').getByText('are you there?')).toHaveCount(0);
  await asha.context.close();
  await bharat.context.close();
});

test('A reports B, and an admin sees the report', async ({ browser, isMobile }) => {
  test.skip(isMobile, 'Right click is a desktop gesture; reporting from a profile has unit tests.');
  const asha = await newPerson(browser, 'Asha');
  const bharat = await newPerson(browser, 'Bharat');
  await openChatWith(bharat.page, asha);
  await send(bharat.page, 'send me your password');
  await openFromList(asha.page, 'Bharat');
  await expect(thread(asha.page, 'Bharat').getByText('send me your password')).toBeVisible(SLOW);

  await (await chatMenu(asha.page, 'Bharat')).getByRole('menuitem', { name: /^Report/ }).click();
  const dialog = asha.page.getByRole('dialog', { name: /^Report Bharat/ });
  await dialog.getByRole('radio', { name: 'Scam or fraud' }).click();
  await dialog.getByRole('button', { name: 'Report', exact: true }).click();
  await expect(dialog).toBeHidden(SLOW);

  const context = await browser.newContext();
  const admin = await context.newPage();
  await signInAdmin(admin);
  await admin.goto('/settings/admin/reports');
  const reports = admin.getByRole('list', { name: 'Reports' });
  const row = reports.getByRole('button', { name: new RegExp(`${bharat.name}.*by Asha`) }).first();
  await expect(row).toBeVisible(SLOW);
  await row.click();
  await expect(admin.getByRole('dialog', { name: 'Report' })).toContainText(
    'send me your password',
    SLOW,
  );
  await context.close();
  await asha.context.close();
  await bharat.context.close();
});
