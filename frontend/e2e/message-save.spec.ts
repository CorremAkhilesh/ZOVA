import { expect, type Page, test } from '@playwright/test';
import { expectSent, newPerson, openChatWith, openFromList, send, thread } from './chat-helpers';
import { SLOW } from './helpers';

// Data loss guard (live bug from the sync stress run): a message must be saved on this device (the
// outbox in IndexedDB) before the box empties. Here the browser's database refuses one write: the
// words must stay in the box with an error, and sending again must deliver them. Every browser.

test.describe.configure({ timeout: 120_000 });

/** The next write to the outbox store fails, as a full disk or a browser bug would make it. */
function failNextOutboxWrite(page: Page) {
  return page.evaluate(() => {
    const store = IDBObjectStore.prototype;
    const original = store.add;
    store.add = function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore['add']>) {
      if (this.name === 'outbox') {
        store.add = original;
        throw new DOMException('The disk is full', 'QuotaExceededError');
      }
      return original.apply(this, args);
    };
  });
}

test('a message the device could not save stays in the box, says so, and goes on the next try', async ({
  browser,
}) => {
  const asha = await newPerson(browser, 'Asha');
  const bharat = await newPerson(browser, 'Bharat');
  await openChatWith(asha.page, bharat);
  await send(asha.page, 'hello first');
  await expectSent(asha.page, bharat.name, 'hello first');

  const box = asha.page.getByRole('textbox', { name: 'Write a message' });
  await failNextOutboxWrite(asha.page);
  await send(asha.page, 'numbers for Friday');
  await expect(asha.page.getByText(/Couldn’t save your message/)).toBeVisible(SLOW);
  await expect(box).toHaveValue('numbers for Friday');

  // Sending again works: it reaches Bharat, once.
  await asha.page.getByRole('button', { name: 'Send' }).click();
  await expect(box).toHaveValue('', SLOW);
  await expectSent(asha.page, bharat.name, 'numbers for Friday');
  await openFromList(bharat.page, asha.name);
  await expect(thread(bharat.page, asha.name).getByText('numbers for Friday')).toHaveCount(1, SLOW);

  await asha.context.close();
  await bharat.context.close();
});
