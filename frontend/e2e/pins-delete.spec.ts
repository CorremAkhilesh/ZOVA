import { expect, type Page, test } from '@playwright/test';
import {
  expectBubbles,
  messageMenu,
  newPerson,
  openChatWith,
  openFromList,
  send,
} from './chat-helpers';
import { SLOW } from './helpers';

// A pinned message deleted for everyone takes its pin with it, on both sides at once: with two pins
// the other one shows; with none left the pin bar goes. Never a pin that opens "This message was
// deleted".

test.describe.configure({ timeout: 240_000 });

const pinBar = (page: Page) => page.getByRole('button', { name: /^Go to pinned message/ });

async function deleteForEveryone(page: Page, chatName: string, text: string) {
  const menu = await messageMenu(page, chatName, text);
  await menu.getByRole('menuitem', { name: 'Delete' }).click();
  await page
    .getByRole('dialog', { name: 'Delete this message?' })
    .getByRole('button', { name: 'Delete for everyone' })
    .click();
}

test('pinned messages deleted for everyone leave both pin bars at once', async ({ browser }) => {
  const asha = await newPerson(browser, 'Asha');
  const bharat = await newPerson(browser, 'Bharat');
  await openChatWith(asha.page, bharat);
  await send(asha.page, 'gate code 4411');
  await send(asha.page, 'wifi is office-guest');
  await expect(bharat.page.getByRole('link', { name: /Asha/ })).toBeVisible(SLOW);
  await openFromList(bharat.page, 'Asha');
  await expectBubbles(bharat.page, 'Asha', ['gate code 4411', 'wifi is office-guest']);

  // Pin both (the newest pin shows first).
  const chatId = new URL(asha.page.url()).pathname.split('/').at(-1) ?? '';
  const history = await (await asha.page.request.get(`/v1/chats/${chatId}/messages`)).json();
  const idOf = (text: string) =>
    (history.items as { id: string; text: string | null }[]).find((item) => item.text === text)?.id;
  for (const text of ['gate code 4411', 'wifi is office-guest']) {
    const pinned = await asha.page.request.put(`/v1/chats/${chatId}/messages/${idOf(text)}/pin`, {
      data: { duration: '7d' },
    });
    expect(pinned.ok(), await pinned.text()).toBe(true);
  }
  for (const page of [asha.page, bharat.page]) {
    await expect(pinBar(page)).toHaveAccessibleName('Go to pinned message 1 of 2', SLOW);
    await expect(pinBar(page)).toContainText('wifi is office-guest');
  }

  await deleteForEveryone(asha.page, 'Bharat', 'wifi is office-guest');
  for (const page of [asha.page, bharat.page]) {
    await expect(pinBar(page)).toHaveAccessibleName('Go to pinned message 1 of 1', SLOW);
    await expect(pinBar(page)).toContainText('gate code 4411');
  }

  await deleteForEveryone(asha.page, 'Bharat', 'gate code 4411');
  for (const page of [asha.page, bharat.page]) await expect(pinBar(page)).toHaveCount(0, SLOW);
  // And it stays gone after a reload (the server unpinned it, not only this screen).
  await bharat.page.reload();
  await expect(bharat.page.getByText('This message was deleted').first()).toBeVisible(SLOW);
  await expect(pinBar(bharat.page)).toHaveCount(0);

  await asha.context.close();
  await bharat.context.close();
});
