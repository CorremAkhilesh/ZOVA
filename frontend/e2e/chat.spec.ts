import { expect, test } from '@playwright/test';
import {
  bubbles,
  expectBubbles,
  localDatabases,
  newPerson,
  openChatWith,
  openFromList,
  secondDevice,
  send,
} from './chat-helpers';
import { open, SLOW, waitForActiveServiceWorker } from './helpers';

test.describe.configure({ timeout: 240_000 });

test('two people chat in real time, and reading clears the badge', async ({ browser }) => {
  const asha = await newPerson(browser, 'Asha');
  const bharat = await newPerson(browser, 'Bharat');

  // A brand new account: the empty state, with Saved Messages still there.
  await expect(asha.page.getByRole('heading', { name: 'No chats yet' })).toBeVisible(SLOW);
  await expect(asha.page.getByRole('link', { name: /Saved Messages/ })).toBeVisible();

  await openChatWith(asha.page, bharat);
  await expect(asha.page.getByText(`@${bharat.username}`)).toBeVisible();
  await send(asha.page, 'Hello Bharat');
  await expectBubbles(asha.page, 'Bharat', ['Hello Bharat']);
  await expect(asha.page.getByRole('img', { name: 'Sent' })).toBeVisible(SLOW);

  // Bharat has not opened anything: the chat appears by itself, with a badge.
  const row = bharat.page.getByRole('link', { name: /Asha/ });
  await expect(row).toContainText('Hello Bharat', SLOW);
  await expect(row.getByLabel('1 unread message')).toBeVisible();

  await row.click();
  await expectBubbles(bharat.page, 'Asha', ['Hello Bharat']);
  await open(bharat.page, '/chats');
  await expect(bharat.page.getByRole('link', { name: /Asha/ })).toContainText('Hello Bharat', SLOW);
  await expect(bharat.page.getByLabel(/unread/)).toHaveCount(0, SLOW);

  await openFromList(bharat.page, 'Asha');
  await send(bharat.page, 'Hi Asha');
  await expectBubbles(asha.page, 'Bharat', ['Hello Bharat', 'Hi Asha']);
  await expectBubbles(bharat.page, 'Asha', ['Hello Bharat', 'Hi Asha']);
  // She is looking at the chat, so it counts as read straight away.
  await open(asha.page, '/chats');
  await expect(asha.page.getByRole('link', { name: /Bharat/ })).toContainText('Hi Asha', SLOW);
  await expect(asha.page.getByLabel(/unread/)).toHaveCount(0);

  await asha.context.close();
  await bharat.context.close();
});

test('messages sent offline arrive in order, once, after reconnecting', async ({
  browser,
  browserName,
}) => {
  const asha = await newPerson(browser, 'Asha');
  if (browserName === 'chromium') await waitForActiveServiceWorker(asha.page);
  const bharat = await newPerson(browser, 'Bharat');
  await openChatWith(asha.page, bharat);
  await send(asha.page, 'before');
  await expect(bharat.page.getByRole('link', { name: /Asha/ })).toBeVisible(SLOW);
  await openFromList(bharat.page, 'Asha');
  await expectBubbles(bharat.page, 'Asha', ['before']);
  await expect(asha.page.getByRole('img', { name: 'Sent' })).toBeVisible(SLOW);

  await asha.context.setOffline(true);
  for (const text of ['one', 'two', 'three']) await send(asha.page, text);
  await expectBubbles(asha.page, 'Bharat', ['before', 'one', 'two', 'three']);
  await expect(asha.page.getByRole('img', { name: 'Sending' })).toHaveCount(3);
  expect(await bubbles(bharat.page, 'Asha')).toEqual(['before']);

  // Still there after a reload while offline: the outbox is stored, not in memory. Only Chromium
  // lets Playwright reload from the service worker (see pwa.spec.ts).
  if (browserName === 'chromium') {
    await asha.page.reload();
    await expectBubbles(asha.page, 'Bharat', ['before', 'one', 'two', 'three']);
  }

  await asha.context.setOffline(false);
  await expectBubbles(bharat.page, 'Asha', ['before', 'one', 'two', 'three']);
  await expect(asha.page.getByRole('img', { name: 'Sent' })).toHaveCount(4, SLOW);

  // Nothing arrives twice, on either side.
  await bharat.page.waitForTimeout(2000);
  expect(await bubbles(bharat.page, 'Asha')).toEqual(['before', 'one', 'two', 'three']);
  expect(await bubbles(asha.page, 'Bharat')).toEqual(['before', 'one', 'two', 'three']);

  await asha.context.close();
  await bharat.context.close();
});

test('a second device gets my sent messages, and my reads', async ({ browser }) => {
  const asha = await newPerson(browser, 'Asha');
  const bharat = await newPerson(browser, 'Bharat');
  await openChatWith(asha.page, bharat);
  await send(asha.page, 'first, from device one');
  await expectBubbles(asha.page, 'Bharat', ['first, from device one']);

  // A new device catches up from the server: chat list, then history.
  const ashaTwo = await secondDevice(browser, asha);
  await openFromList(ashaTwo, 'Bharat');
  await expectBubbles(ashaTwo, 'Bharat', ['first, from device one']);

  // Live: the other device gets what this one sends.
  await send(asha.page, 'second, from device one');
  await expectBubbles(ashaTwo, 'Bharat', ['first, from device one', 'second, from device one']);

  // Reading on one device clears the badge on the other.
  await open(ashaTwo, '/chats');
  await expect(ashaTwo.getByRole('link', { name: /Bharat/ })).toBeVisible(SLOW);
  await open(asha.page, '/chats');
  await expect(asha.page.getByRole('link', { name: /Bharat/ })).toBeVisible(SLOW);
  await openFromList(bharat.page, 'Asha');
  await send(bharat.page, 'a reply');
  await expect(ashaTwo.getByLabel('1 unread message')).toBeVisible(SLOW);
  await expect(asha.page.getByLabel('1 unread message')).toBeVisible(SLOW);
  await openFromList(asha.page, 'Bharat');
  await expect(ashaTwo.getByLabel(/unread/)).toHaveCount(0, SLOW);

  await ashaTwo.context().close();
  await asha.context.close();
  await bharat.context.close();
});

test('signing out leaves nothing of the user in the browser', async ({ browser }) => {
  const asha = await newPerson(browser, 'Asha');
  const { page } = asha;
  await expect(page.getByRole('link', { name: /Saved Messages/ })).toBeVisible(SLOW);
  await openFromList(page, 'Saved Messages');
  await send(page, 'a note to myself');
  await expectBubbles(page, 'Saved Messages', ['a note to myself']);
  await page.getByRole('textbox', { name: 'Write a message' }).fill('an unsent draft');
  await expect.poll(() => localDatabases(page)).toHaveLength(1);

  await open(page, '/settings');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: /Welcome to/ })).toBeVisible(SLOW);
  await expect.poll(() => localDatabases(page), SLOW).toEqual([]);
  await asha.context.close();
});

test('being signed out from another device wipes this one too', async ({ browser }) => {
  const asha = await newPerson(browser, 'Asha');
  const other = await secondDevice(browser, asha);
  await expect.poll(() => localDatabases(other), SLOW).toHaveLength(1);
  await open(asha.page, '/settings/devices');
  await asha.page.getByRole('button', { name: 'Sign out all other devices' }).click();
  await asha.page
    .getByRole('dialog')
    .getByRole('button', { name: 'Sign out all other devices' })
    .click();
  await expect(other.getByRole('heading', { name: /Welcome to/ })).toBeVisible(SLOW);
  await expect.poll(() => localDatabases(other), SLOW).toEqual([]);
  // The device that stayed signed in keeps its data.
  expect(await localDatabases(asha.page)).toHaveLength(1);
  await other.context().close();
  await asha.context.close();
});

test('long chats: older messages load in place, and new ones wait behind a button', async ({
  browser,
}) => {
  const asha = await newPerson(browser, 'Asha');
  const bharat = await newPerson(browser, 'Bharat');
  await openChatWith(asha.page, bharat);
  const chatId = /\/chats\/([0-9a-f]{24})$/.exec(asha.page.url())?.[1];
  const seeded = await asha.page.request.post('/v1/test/seed-messages', {
    data: { chatId, email: bharat.email, count: 120 },
  });
  expect(seeded.ok()).toBe(true);

  // A new device has none of it, so it fetches the newest page and shows the end of the chat.
  const page = await secondDevice(browser, asha);
  await openFromList(page, 'Bharat');
  const list = page.getByRole('list', { name: 'Bharat', exact: true });
  await expect(list.getByText('seeded 120', { exact: true })).toBeInViewport(SLOW);

  // To the top of what is loaded: the same message must stay where it was as older ones arrive.
  const scroller = page.getByLabel('Messages', { exact: true });
  const anchor = list.getByText('seeded 71', { exact: true });
  // Repeats: while the newest rows are still being measured, the list keeps itself at the bottom.
  await expect(async () => {
    await scroller.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect(anchor).toBeVisible({ timeout: 1000 });
  }).toPass(SLOW);
  // Five rows above the anchor: within the rows the list keeps just outside the viewport.
  await expect(list.getByText('seeded 66', { exact: true })).toBeAttached(SLOW);
  await expect(anchor).toBeInViewport();

  // The reader is far from the bottom: a new message waits behind the button.
  await send(asha.page, 'new while scrolled up');
  const jump = page.getByRole('button', { name: /Jump to latest/ });
  await expect(jump).toContainText('1', SLOW);
  await expect(anchor).toBeInViewport();
  await jump.click();
  await expect(list.getByText('new while scrolled up', { exact: true })).toBeInViewport(SLOW);
  await expect(jump).toBeHidden();

  await page.context().close();
  await asha.context.close();
  await bharat.context.close();
});
