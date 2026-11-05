import { randomBytes } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import {
  bubbles,
  expectBubbles,
  newPerson,
  openChatWith,
  openFromList,
  type Person,
  send,
} from './chat-helpers';
import { open, SLOW, signUp } from './helpers';

test.describe.configure({ timeout: 240_000 });

/** A small valid PNG, a different picture each time. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAEklEQVR4nGNk+M+ABIwMDAwAFAoBAX1Nz8QAAAAASUVORK5CYII=',
  'base64',
);
const png = (name: string) => ({ name, mimeType: 'image/png', buffer: PNG });
const PDF = {
  name: 'report.pdf',
  mimeType: 'application/pdf',
  buffer: Buffer.concat([Buffer.from('%PDF-1.7\n'), randomBytes(4096)]),
};

const thread = (page: Page, name: string) => page.getByRole('list', { name, exact: true });

/** Both people in the same chat, with one message so the second has it in their list. */
async function chatting(browser: Parameters<typeof newPerson>[0]): Promise<[Person, Person]> {
  const asha = await newPerson(browser, 'Asha');
  const bharat = await newPerson(browser, 'Bharat');
  await openChatWith(asha.page, bharat);
  await send(asha.page, 'hello');
  await expect(bharat.page.getByRole('link', { name: /Asha/ })).toBeVisible(SLOW);
  await openFromList(bharat.page, 'Asha');
  await expectBubbles(bharat.page, 'Asha', ['hello']);
  return [asha, bharat];
}

async function sendFile(page: Page, testId: string, files: Parameters<Page['setInputFiles']>[1]) {
  await page.getByRole('button', { name: 'Attach a file' }).click();
  await page.getByTestId(testId).setInputFiles(files);
}

test('photos with captions and a PDF reach the other person, and the viewer opens', async ({
  browser,
}) => {
  const [asha, bharat] = await chatting(browser);

  await sendFile(asha.page, 'pick-media', [png('one.png'), png('two.png'), png('three.png')]);
  const sheet = asha.page.getByRole('dialog', { name: 'Send 3 files' });
  await sheet.getByRole('textbox', { name: 'Caption for one.png' }).fill('First photo');
  await sheet.getByRole('textbox', { name: 'Caption for two.png' }).fill('Second photo');
  await sheet.getByRole('button', { name: 'Send 3' }).click();
  await expect(sheet).toBeHidden(SLOW);

  // One album, one bubble, thumbnails loaded.
  const theirs = thread(bharat.page, 'Asha');
  await expect(theirs.getByRole('button', { name: /Open photo/ })).toHaveCount(3, SLOW);
  await expect(theirs.locator('img:not(.blur-md)').first()).toBeVisible(SLOW);
  await expect(theirs.getByText('First photo')).toBeVisible();

  // The viewer: full picture, arrows between items, Esc to leave.
  await theirs
    .getByRole('button', { name: /Open photo/ })
    .first()
    .click();
  const viewer = bharat.page.getByRole('dialog');
  await expect(viewer.getByText('First photo')).toBeVisible(SLOW);
  const full = viewer.getByRole('img', { name: 'First photo' });
  await expect
    .poll(() => full.evaluate((image: HTMLImageElement) => image.naturalWidth), SLOW)
    .toBeGreaterThan(0);
  await bharat.page.keyboard.press('ArrowRight');
  await expect(viewer.getByText('Second photo')).toBeVisible(SLOW);
  await bharat.page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  await expect(bharat.page).toHaveURL(/\/chats\/[0-9a-f]{24}$/);

  // A document: a card, and a real download.
  await sendFile(asha.page, 'pick-document', PDF);
  const docSheet = asha.page.getByRole('dialog', { name: 'Send 1 file' });
  await docSheet.getByRole('textbox', { name: 'Caption for report.pdf' }).fill('The figures');
  await docSheet.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(theirs.getByText('report.pdf')).toBeVisible(SLOW);
  await expect(theirs.getByText('The figures')).toBeVisible();
  const downloading = bharat.page.waitForEvent('download');
  await theirs.getByRole('button', { name: 'Download report.pdf' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('report.pdf');

  // In the list, and in chat info.
  await open(bharat.page, '/chats');
  await expect(bharat.page.getByRole('link', { name: /Asha/ })).toContainText(
    '📄 report.pdf · The figures',
    SLOW,
  );

  await asha.context.close();
  await bharat.context.close();
});

test('an upload interrupted by going offline resumes, and arrives once', async ({ browser }) => {
  const [asha, bharat] = await chatting(browser);
  // Big enough to take several chunks, so going offline lands in the middle.
  const big = {
    name: 'big.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.concat([Buffer.from('%PDF-1.7\n'), randomBytes(20 * 1024 * 1024)]),
  };
  // Each chunk is held back, so the upload is still going when the connection drops.
  await asha.page.route('**/v1/uploads/*', async (route) => {
    if (route.request().method() === 'PATCH') {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    await route.continue().catch(() => undefined);
  });

  await sendFile(asha.page, 'pick-document', big);
  await asha.page
    .getByRole('dialog', { name: 'Send 1 file' })
    .getByRole('button', { name: 'Send', exact: true })
    .click();
  const ring = thread(asha.page, 'Bharat').getByRole('button', { name: /Cancel upload/ });
  await expect(ring).toBeVisible(SLOW);
  await expect(ring).not.toHaveAccessibleName('Cancel upload, 0% done', SLOW);

  await asha.context.setOffline(true);
  await asha.page.waitForTimeout(1500);
  await expect(thread(asha.page, 'Bharat').getByText('big.pdf')).toBeVisible();
  await expect(thread(bharat.page, 'Asha').getByText('big.pdf')).toHaveCount(0);

  await asha.context.setOffline(false);
  await expect(thread(bharat.page, 'Asha').getByText('big.pdf')).toBeVisible({ timeout: 120_000 });
  await expect(ring).toHaveCount(0, { timeout: 60_000 });

  // Once, on both sides.
  await bharat.page.waitForTimeout(2000);
  await expect(thread(bharat.page, 'Asha').getByText('big.pdf')).toHaveCount(1);
  await expect(thread(asha.page, 'Bharat').getByText('big.pdf')).toHaveCount(1);
  expect(await bubbles(bharat.page, 'Asha')).toContain('hello');

  await asha.context.close();
  await bharat.context.close();
});

test('the folder chips scroll sideways with no scrollbar, in a narrow window', async ({ page }) => {
  await page.setViewportSize({ width: 240, height: 700 });
  await signUp(page, 'Chips');
  const row = page.getByRole('tablist', { name: 'Chat folders' });
  const measured = await row.evaluate((element: HTMLElement) => ({
    scrollable: element.scrollWidth > element.clientWidth,
    scrollbar: element.offsetHeight - element.clientHeight,
    width: getComputedStyle(element).scrollbarWidth,
  }));
  expect(measured).toEqual({ scrollable: true, scrollbar: 0, width: 'none' });
  await row.getByRole('tab', { name: 'Groups' }).focus();
  await expect(row.getByRole('tab', { name: 'Groups' })).toBeInViewport();
});
