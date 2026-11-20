import { expect, type Page, test } from '@playwright/test';
import { newPerson, type Person } from './chat-helpers';
import { SLOW } from './helpers';

// Status: Asha posts (text and a photo) to everyone except Chitra. Bharat, on a 375 px phone, sees it
// arrive, opens it, and replies: the reply lands in their 1:1 chat with the status above it. Asha
// sees Bharat in "Viewed by". Chitra never sees it. STATUS_SHOTS=<folder> keeps screenshots.

test.describe.configure({ timeout: 300_000 });

const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAEklEQVR4nGNk+M+ABIwMDAwAFAoBAX1Nz8QAAAAASUVORK5CYII=';
const PHONE = { width: 375, height: 812 };

async function toStatus(page: Page) {
  await page.goto('/updates');
  await expect(page.getByRole('heading', { name: 'Status', level: 1 })).toBeVisible(SLOW);
}

async function shot(page: Page, name: string) {
  const folder = process.env.STATUS_SHOTS;
  if (!folder) return;
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${folder}/status-${name}-${scheme}.png` });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

async function postText(page: Page, text: string) {
  await page.getByRole('button', { name: 'New text status' }).click();
  const editor = page.getByRole('dialog', { name: 'New text status' });
  await editor.getByRole('textbox', { name: 'What’s on your mind?' }).fill(text);
  await editor.getByRole('button', { name: 'Rose' }).click();
  await shot(page, 'editor');
  await editor.getByRole('button', { name: 'Post' }).click();
  await expect(editor).toBeHidden(SLOW);
}

async function postPhoto(page: Page, caption: string) {
  await page.getByTestId('pick-status-media').setInputFiles({
    name: 'office.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PNG, 'base64'),
  });
  const sheet = page.getByRole('dialog', { name: 'New photo status' });
  await sheet.getByRole('textbox', { name: 'Add a caption' }).fill(caption);
  await sheet.getByRole('button', { name: 'Post' }).click();
  await expect(sheet).toBeHidden(SLOW);
}

const row = (page: Page, person: Person) =>
  page.getByRole('button', { name: new RegExp(`^${person.name}`) });

test('post a status, a colleague sees it, views it and replies; the excluded one never sees it', async ({
  browser,
}) => {
  const asha = await newPerson(browser, 'Asha');
  const bharat = await newPerson(browser, 'Bharat');
  const chitra = await newPerson(browser, 'Chitra');
  const chitraId = (await (await chitra.page.request.get('/v1/auth/me')).json()).user.id as string;
  const privacy = await asha.page.request.put('/v1/me/status-privacy', {
    data: { mode: 'except', userIds: [chitraId] },
  });
  expect(privacy.ok(), `${privacy.status()} ${await privacy.text()}`).toBe(true);

  await bharat.page.setViewportSize(PHONE);
  await toStatus(bharat.page);
  await toStatus(chitra.page);

  await toStatus(asha.page);
  await postText(asha.page, 'Standup moved to 11 today');
  await postPhoto(asha.page, 'New office plants');
  await expect(asha.page.getByRole('button', { name: /^My status 2 updates/ })).toBeVisible(SLOW);

  // It arrives by itself (socket), in "Recent updates", with a ring of two parts.
  const recent = bharat.page.getByRole('list', { name: 'Recent updates' });
  const fromAsha = recent.getByRole('button', { name: /^Asha.*new/ });
  await expect(fromAsha).toBeVisible(SLOW);
  // Asha's ring only: other tests' people post statuses too.
  await expect(fromAsha.getByTestId('status-ring').locator('circle')).toHaveCount(2);
  await shot(bharat.page, 'list-phone');

  await row(bharat.page, asha).click();
  const viewer = bharat.page.getByRole('dialog', { name: 'Asha’s status' });
  await expect(viewer.getByText('Standup moved to 11 today')).toBeVisible(SLOW);
  await shot(bharat.page, 'viewer-text-phone');
  // On a phone the reply box opens from the "Reply" bar under the status.
  await viewer.getByRole('button', { name: 'Reply', exact: true }).click();
  await viewer.getByRole('textbox', { name: /Reply to Asha/ }).fill('On it, thanks!');
  await viewer.getByRole('button', { name: 'Send reply' }).click();
  await expect(bharat.page.getByText('Sent to Asha')).toBeVisible(SLOW);
  await bharat.page.keyboard.press('ArrowRight');
  await expect(viewer.getByRole('img', { name: 'New office plants' })).toBeVisible(SLOW);
  await shot(bharat.page, 'viewer-photo-phone');
  await bharat.page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  await expect(
    bharat.page.getByRole('list', { name: 'Viewed updates' }).getByText('Asha'),
  ).toBeVisible(SLOW);

  // Asha: the reply is in the chat with the status above it, and Bharat is in "Viewed by".
  await asha.page.goto('/chats');
  await asha.page.getByRole('link', { name: /Bharat/ }).click();
  const thread = asha.page.getByRole('list', { name: 'Bharat', exact: true });
  await expect(thread.getByText('On it, thanks!')).toBeVisible(SLOW);
  await expect(thread.getByText('Status')).toBeVisible();
  await expect(thread.getByText('Standup moved to 11 today')).toBeVisible();
  await shot(asha.page, 'reply-in-chat');

  await toStatus(asha.page);
  await shot(asha.page, 'list-desktop');
  await asha.page.getByRole('button', { name: /^My status/ }).click();
  const mine = asha.page.getByRole('dialog', { name: 'My status' });
  await expect(mine.getByText('Standup moved to 11 today')).toBeVisible(SLOW);
  await shot(asha.page, 'viewer-own-desktop');
  await mine.getByRole('button', { name: /Viewed by 1/ }).click();
  await expect(asha.page.getByRole('list', { name: 'Viewed by' }).getByText('Bharat')).toBeVisible(
    SLOW,
  );
  await shot(asha.page, 'viewed-by-desktop');

  // Chitra was left out: nothing from Asha, even after a reload.
  await chitra.page.reload();
  await expect(chitra.page.getByRole('heading', { name: 'Status', level: 1 })).toBeVisible(SLOW);
  await expect(row(chitra.page, asha)).toHaveCount(0);
  await shot(chitra.page, 'empty-desktop');

  await asha.context.close();
  await bharat.context.close();
  await chitra.context.close();
});
