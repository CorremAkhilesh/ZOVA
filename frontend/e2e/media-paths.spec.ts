import { randomBytes } from 'node:crypto';
import { expect, type Page, test } from '@playwright/test';
import { newPerson, openFromList } from './chat-helpers';
import { SLOW } from './helpers';

// Production bug (2026-11-18): a photo in Saved Messages stayed "Not sent", and every retry asked
// GET /v1/uploads/ with an empty upload id. Each way of adding a photo is sent here, to Saved
// Messages, and must arrive; and a reload in the middle of an upload must still finish it.

test.describe.configure({ timeout: 240_000 });

/** A small valid PNG. */
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAEklEQVR4nGNk+M+ABIwMDAwAFAoBAX1Nz8QAAAAASUVORK5CYII=';
const SAVED = 'Saved Messages';

const thread = (page: Page) => page.getByRole('list', { name: SAVED, exact: true });
const composer = (page: Page) => page.getByRole('textbox', { name: 'Write a message' });

/** Fails the test if the app ever asks about an upload without an id (the production bug). */
function watchUploadIds(page: Page): string[] {
  const empty: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (/^\/v1\/uploads\/?$/.test(path) && request.method() !== 'POST') empty.push(path);
    if (/\/v1\/uploads\/(undefined|null)\b/.test(path)) empty.push(path);
  });
  return empty;
}

async function openSaved(browser: Parameters<typeof newPerson>[0]) {
  const me = await newPerson(browser, 'Saanvi');
  await expect(me.page.getByRole('link', { name: /Saved Messages/ })).toBeVisible(SLOW);
  await openFromList(me.page, SAVED);
  // Empty, so no message list yet: the composer says the chat is open.
  await expect(composer(me.page)).toBeVisible(SLOW);
  return me;
}

/** Gives the page a file the way the browser does on paste or drop: the same events and data. */
async function handOver(page: Page, how: 'paste' | 'drop', name: string) {
  // The composer is inside the drop zone, so a drop there bubbles to it like a real one.
  const target = composer(page);
  await target.evaluate(
    (element, { how, png, name }) => {
      const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], name, { type: 'image/png' }));
      const fire = (type: string) => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, how === 'paste' ? 'clipboardData' : 'dataTransfer', {
          value: data,
        });
        element.dispatchEvent(event);
      };
      if (how === 'paste') {
        (element as HTMLElement).focus();
        fire('paste');
      } else {
        for (const type of ['dragenter', 'dragover', 'drop']) fire(type);
      }
    },
    { how, png: PNG, name },
  );
}

async function sendSheet(page: Page) {
  const sheet = page.getByRole('dialog', { name: 'Send 1 file' });
  await sheet.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(sheet).toBeHidden(SLOW);
}

/** Sent, as the sender sees it: no progress ring, no clock, no "Not sent". */
async function expectSent(page: Page, count: number) {
  const mine = thread(page);
  await expect(mine.getByRole('button', { name: /Open photo|Download/ })).toHaveCount(count, SLOW);
  await expect(mine.getByRole('button', { name: /Cancel upload/ })).toHaveCount(0, SLOW);
  await expect(mine.getByRole('img', { name: 'Sending' })).toHaveCount(0, SLOW);
  await expect(mine.getByText(/Not sent/)).toHaveCount(0);
}

test('a photo from the 📎 picker, Ctrl+V and drag-and-drop all reach Saved Messages', async ({
  browser,
}) => {
  const me = await openSaved(browser);
  const empty = watchUploadIds(me.page);
  const bytes = Buffer.from(PNG, 'base64');

  await me.page.getByRole('button', { name: 'Attach a file' }).click();
  await me.page
    .getByTestId('pick-media')
    .setInputFiles({ name: 'picked.png', mimeType: 'image/png', buffer: bytes });
  await sendSheet(me.page);
  await expectSent(me.page, 1);

  await handOver(me.page, 'paste', 'pasted.png');
  await sendSheet(me.page);
  await expectSent(me.page, 2);

  await handOver(me.page, 'drop', 'dropped.png');
  await sendSheet(me.page);
  await expectSent(me.page, 3);

  // They are on the server, not only on this device.
  await me.page.reload();
  await expectSent(me.page, 3);
  expect(empty).toEqual([]);
  await me.context.close();
});

test('reloading in the middle of an upload carries on, and it arrives once', async ({
  browser,
}) => {
  const me = await openSaved(browser);
  const empty = watchUploadIds(me.page);
  // Several chunks, each held back, so the reload lands in the middle.
  await me.page.route('**/v1/uploads/*', async (route) => {
    if (route.request().method() === 'PATCH') {
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    await route.continue().catch(() => undefined);
  });
  const buffer = Buffer.concat([Buffer.from('%PDF-1.7\n'), randomBytes(12 * 1024 * 1024)]);
  await me.page.getByRole('button', { name: 'Attach a file' }).click();
  await me.page
    .getByTestId('pick-document')
    .setInputFiles({ name: 'halfway.pdf', mimeType: 'application/pdf', buffer });
  await sendSheet(me.page);
  const ring = thread(me.page).getByRole('button', { name: /Cancel upload/ });
  await expect(ring).toBeVisible(SLOW);
  await expect(ring).not.toHaveAccessibleName('Cancel upload, 0% done', SLOW);

  await me.page.reload();
  await expect(thread(me.page).getByText('halfway.pdf')).toBeVisible(SLOW);
  await expect(ring).toHaveCount(0, { timeout: 120_000 });
  await expect(thread(me.page).getByText(/Not sent/)).toHaveCount(0);

  // Once, from the server.
  await me.page.reload();
  await expect(thread(me.page).getByText('halfway.pdf')).toHaveCount(1, SLOW);
  await expect(thread(me.page).getByRole('img', { name: 'Sending' })).toHaveCount(0, SLOW);
  expect(empty).toEqual([]);
  await me.context.close();
});
