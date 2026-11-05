import { expect, test } from '@playwright/test';
import { expectBubbles, newPerson, openChatWith, openFromList, send } from './chat-helpers';
import { open, SLOW } from './helpers';

test.describe.configure({ timeout: 240_000 });

const lastTick = (page: import('@playwright/test').Page, chatName: string) =>
  page.getByRole('list', { name: chatName, exact: true }).getByRole('img').last();

test('ticks, read-receipt privacy, typing and last seen between two people', async ({
  browser,
}) => {
  const asha = await newPerson(browser, 'Asha');
  const bharat = await newPerson(browser, 'Bharat');
  await openChatWith(asha.page, bharat);

  // A sends while B is online but not in the chat: B's device received it.
  await send(asha.page, 'one');
  await expect(lastTick(asha.page, 'Bharat')).toHaveAccessibleName('Delivered', SLOW);

  // Online is visible both ways, with a status in the header.
  await expect(asha.page.getByText('online', { exact: true })).toBeVisible(SLOW);

  // B opens the chat: A sees it read.
  await openFromList(bharat.page, 'Asha');
  await expectBubbles(bharat.page, 'Asha', ['one']);
  await expect(lastTick(asha.page, 'Bharat')).toHaveAccessibleName('Read', SLOW);

  // B types: A sees it in the header, and it goes when B stops.
  const typing = asha.page.getByText('typing…');
  await bharat.page.getByRole('textbox', { name: 'Write a message' }).pressSequentially('hel');
  await expect(typing.first()).toBeVisible(SLOW);
  await bharat.page.getByRole('textbox', { name: 'Write a message' }).fill('');
  await expect(typing).toHaveCount(0, SLOW);

  // B turns read receipts off: A's new message never goes past delivered, even once read.
  await open(bharat.page, '/settings/privacy');
  const off = bharat.page
    .getByRole('radiogroup', { name: /Read receipts/ })
    .getByRole('radio', { name: 'Off' });
  await off.click();
  await expect(off).toHaveAttribute('aria-checked', 'true', SLOW);
  await open(bharat.page, '/chats');
  await send(asha.page, 'two');
  await expect(lastTick(asha.page, 'Bharat')).toHaveAccessibleName('Delivered', SLOW);
  await openFromList(bharat.page, 'Asha');
  await expectBubbles(bharat.page, 'Asha', ['one', 'two']);
  await expect(bharat.page.getByLabel(/unread/)).toHaveCount(0, SLOW);
  await asha.page.waitForTimeout(2000);
  await expect(lastTick(asha.page, 'Bharat')).toHaveAccessibleName('Delivered');
  // What was already read stays read.
  await expect(
    asha.page.getByRole('list', { name: 'Bharat', exact: true }).getByRole('img', { name: 'Read' }),
  ).toHaveCount(1);

  // B closes the page: A sees when B was last here.
  await bharat.context.close();
  await expect(asha.page.getByText(/^last seen today at/)).toBeVisible(SLOW);

  await asha.context.close();
});
