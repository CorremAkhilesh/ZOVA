import { expect, type Page, test } from '@playwright/test';
import { createGroup, newPerson, openFromList, send, thread } from './chat-helpers';
import { SLOW } from './helpers';

// Three people in a group send 50 messages at once (40 texts and 10 files), and one of them drops
// off the network halfway and comes back. Every device must end with all 50 in its open chat, in
// the server's order, each once. CI runs this ten times in a row (ci.yml, "Sync stress").

test.describe.configure({ timeout: 360_000 });
test.use({ actionTimeout: 30_000 });

const GROUP = 'Stress';
const LONG = { timeout: 180_000 };

/** This device's stored messages of the chat, as the open chat reads them: [seq, label]. */
function stored(page: Page, chatId: string) {
  return page.evaluate(async (id) => {
    const names = (await indexedDB.databases()).map((db) => db.name ?? '');
    const name = names.find((candidate) => candidate.startsWith('zuvo-user-')) ?? '';
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const rows = await new Promise<
      Array<{ chatId: string; seq: number | null; text: string | null; media?: { name?: string } }>
    >((resolve) => {
      const request = db.transaction('messages').objectStore('messages').getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve([]);
    });
    db.close();
    return rows
      .filter((row) => row.chatId === id)
      .map((row) => [row.seq, row.media?.name ?? row.text ?? ''] as const)
      .filter(([, label]) => label.startsWith('stress-'))
      .sort((a, b) => (a[0] ?? Number.MAX_SAFE_INTEGER) - (b[0] ?? Number.MAX_SAFE_INTEGER));
  }, chatId);
}

async function sendFiles(page: Page, count: number) {
  await page.getByRole('button', { name: 'Attach a file' }).click();
  await page.getByTestId('pick-document').setInputFiles(
    Array.from({ length: count }, (_, index) => ({
      name: `stress-file-${String(index + 1).padStart(2, '0')}.pdf`,
      mimeType: 'application/pdf',
      buffer: Buffer.from(`%PDF-1.7\nfile ${index + 1}\n`),
    })),
  );
  await page
    .getByRole('dialog', { name: `Send ${count} files` })
    .getByRole('button', { name: `Send ${count}`, exact: true })
    .click();
}

async function sendTexts(page: Page, who: string, from: number, to: number) {
  for (let n = from; n <= to; n++) await send(page, `stress-${who}-${String(n).padStart(2, '0')}`);
}

test('50 messages at once from three people, one of them offline halfway: all, in order, once', async ({
  browser,
}) => {
  const asha = await newPerson(browser, 'Asha');
  const bharat = await newPerson(browser, 'Bharat');
  const chitra = await newPerson(browser, 'Chitra');
  await createGroup(asha.page, GROUP, [bharat, chitra]);
  const chatId = new URL(asha.page.url()).pathname.split('/').at(-1) ?? '';
  for (const person of [bharat, chitra]) {
    await expect(person.page.getByRole('link', { name: new RegExp(GROUP) })).toBeVisible(SLOW);
    await openFromList(person.page, GROUP);
  }

  await Promise.all([
    sendTexts(asha.page, 'asha', 1, 20),
    (async () => {
      await sendTexts(bharat.page, 'bharat', 1, 10);
      // Off the network halfway: what Bharat writes waits, what the others send is missed live.
      await bharat.context.setOffline(true);
      await sendTexts(bharat.page, 'bharat', 11, 20);
      await bharat.page.waitForTimeout(3_000);
      await bharat.context.setOffline(false);
    })(),
    sendFiles(chitra.page, 10),
  ]);

  // The server's order is the truth.
  const fromServer = async () => {
    const response = await asha.page.request.get(`/v1/chats/${chatId}/messages?limit=100`);
    const body = (await response.json()) as {
      items: Array<{ seq: number; text: string | null; media: { name: string } | null }>;
    };
    return body.items
      .map((item) => [item.seq, item.media?.name ?? item.text ?? ''] as const)
      .filter(([, label]) => label.startsWith('stress-'));
  };
  await expect.poll(async () => (await fromServer()).length, LONG).toBe(50);
  const truth = await fromServer();

  for (const person of [asha, bharat, chitra]) {
    await expect
      .poll(async () => JSON.stringify(await stored(person.page, chatId)), LONG)
      .toBe(JSON.stringify(truth));
    // And the open chat shows the newest of them.
    const newest = truth.at(-1)?.[1] ?? '';
    await expect(thread(person.page, GROUP).getByText(newest).first()).toBeVisible(SLOW);
  }

  await asha.context.close();
  await bharat.context.close();
  await chitra.context.close();
});
