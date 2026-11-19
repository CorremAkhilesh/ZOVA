import { expect, type Page, test } from '@playwright/test';
import { newPerson, openFromList } from './chat-helpers';
import { SLOW } from './helpers';

// The composer (one rounded box: emoji, text, attach, the camera on phones; mic or send next to it),
// on a desktop and on a 375 px phone: a message, a photo from 📎 and from Ctrl+V, and a voice note.

test.describe.configure({ timeout: 240_000 });

const SAVED = 'Saved Messages';
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAEklEQVR4nGNk+M+ABIwMDAwAFAoBAX1Nz8QAAAAASUVORK5CYII=';

const thread = (page: Page) => page.getByRole('list', { name: SAVED, exact: true });
const composer = (page: Page) => page.getByRole('textbox', { name: 'Write a message' });

async function openSaved(browser: Parameters<typeof newPerson>[0]) {
  const me = await newPerson(browser, 'Kavya');
  await expect(me.page.getByRole('link', { name: /Saved Messages/ })).toBeVisible(SLOW);
  await openFromList(me.page, SAVED);
  await expect(composer(me.page)).toBeVisible(SLOW);
  return me;
}

/** Height, and whether a scrollbar would show (more content than room). */
const measure = (page: Page) =>
  composer(page).evaluate((element: HTMLTextAreaElement) => ({
    height: element.getBoundingClientRect().height,
    overflows: element.scrollHeight > element.clientHeight + 1,
    overflowY: getComputedStyle(element).overflowY,
  }));

async function pastePhoto(page: Page, name: string) {
  await composer(page).evaluate(
    (element, { png, name }) => {
      const bytes = Uint8Array.from(atob(png), (char) => char.charCodeAt(0));
      const data = new DataTransfer();
      data.items.add(new File([bytes], name, { type: 'image/png' }));
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: data });
      (element as HTMLElement).focus();
      element.dispatchEvent(event);
    },
    { png: PNG, name },
  );
}

async function sendSheet(page: Page) {
  const sheet = page.getByRole('dialog', { name: 'Send 1 file' });
  await sheet.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(sheet).toBeHidden(SLOW);
}

const photos = (page: Page) => thread(page).getByRole('button', { name: /Open photo/ });

for (const device of [
  { name: 'desktop', viewport: { width: 1280, height: 800 }, desktop: true },
  { name: 'phone 375', viewport: { width: 375, height: 812 }, desktop: false },
]) {
  test.describe(device.name, () => {
    test.use({ viewport: device.viewport });

    test('the composer is one line high, grows to six lines, then scrolls inside', async ({
      browser,
    }) => {
      const me = await openSaved(browser);
      const empty = await measure(me.page);
      // One line, with no scrollbar (the ▲▼ arrows Windows drew on the old one).
      expect(empty.height).toBeGreaterThanOrEqual(40);
      expect(empty.height).toBeLessThanOrEqual(50);
      expect(empty.overflows).toBe(false);
      await composer(me.page).fill('one\ntwo\nthree');
      const three = await measure(me.page);
      expect(three.height).toBeGreaterThan(empty.height + 30);
      expect(three.overflows).toBe(false);
      await composer(me.page).fill(Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n'));
      const twelve = await measure(me.page);
      expect(twelve.height).toBeLessThanOrEqual(170);
      expect(twelve.overflowY).toBe('auto');
      await me.context.close();
    });

    test('a message, a photo from 📎 and from Ctrl+V reach Saved Messages', async ({ browser }) => {
      const me = await openSaved(browser);
      await composer(me.page).fill('hello from the new composer');
      if (device.desktop) await composer(me.page).press('Enter');
      else await me.page.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(thread(me.page).getByText('hello from the new composer')).toBeVisible(SLOW);
      await expect(composer(me.page)).toHaveValue('');
      // Back to the mic once the box is empty.
      await expect(me.page.getByRole('button', { name: 'Record a voice note' })).toBeVisible();

      await me.page.getByRole('button', { name: 'Attach a file' }).click();
      await me.page.getByTestId('pick-media').setInputFiles({
        name: 'picked.png',
        mimeType: 'image/png',
        buffer: Buffer.from(PNG, 'base64'),
      });
      await sendSheet(me.page);
      await expect(photos(me.page)).toHaveCount(1, SLOW);

      await pastePhoto(me.page, 'pasted.png');
      await sendSheet(me.page);
      await expect(photos(me.page)).toHaveCount(2, SLOW);
      await expect(thread(me.page).getByText(/Not sent/)).toHaveCount(0);
      await me.context.close();
    });

    test('a voice note, recorded with the mic button', async ({ browser, browserName }) => {
      test.skip(browserName !== 'chromium', 'A fake microphone needs Chromium launch flags');
      const me = await openSaved(browser);
      await me.page.getByRole('button', { name: 'Record a voice note' }).click();
      const allow = me.page.getByRole('button', { name: 'Continue' });
      await expect(allow.or(me.page.getByRole('timer'))).toBeVisible(SLOW);
      if (await allow.isVisible()) await allow.click();
      await expect(me.page.getByRole('timer')).toHaveText('0:02', { timeout: 30_000 });
      await me.page.getByRole('button', { name: 'Send voice message' }).click();
      await expect(thread(me.page).getByRole('button', { name: 'Play voice message' })).toBeVisible(
        { timeout: 60_000 },
      );
      await me.context.close();
    });
  });
}
