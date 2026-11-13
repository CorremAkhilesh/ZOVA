import { expect, type Page, test } from '@playwright/test';
import {
  createGroup,
  expectBubbles,
  newPerson,
  openChatWith,
  openFromList,
  type Person,
  send,
} from './chat-helpers';
import { SLOW } from './helpers';

/**
 * Web Push through the test API: the E2E server records pushes instead of sending them, and a
 * device registers a stub subscription (any https endpoint, keys of the right shape). What the
 * service worker then shows is covered by the unit tests; a real push service needs HTTPS.
 */
test.describe.configure({ timeout: 240_000 });
test.use({ actionTimeout: 30_000 });

/** A burst is collected for 500 ms in E2E: wait well past it before saying "no push". */
const QUIET_MS = 3_000;

interface RecordedPush {
  payload: {
    kind: string;
    title: string;
    body: string;
    chatId?: string;
    tag: string;
    hidden?: boolean;
  };
}

/** This device gets pushes, through a stub push service. */
async function stubPush(page: Page): Promise<void> {
  await page.context().grantPermissions(['notifications']);
  const response = await page.request.put('/v1/me/push/subscription', {
    data: {
      endpoint: `https://push.example.test/send/${crypto.randomUUID()}`,
      expirationTime: null,
      keys: { p256dh: `B${'A'.repeat(86)}`, auth: 'A'.repeat(22) },
    },
  });
  expect(response.ok()).toBe(true);
}

async function pushesTo(page: Page, person: Person): Promise<RecordedPush[]> {
  const response = await page.request.get(
    `/v1/test/push/outbox?email=${encodeURIComponent(person.email)}`,
  );
  expect(response.ok()).toBe(true);
  return (await response.json()).pushes as RecordedPush[];
}

/** As if B switched to another browser tab: the page is hidden and has no focus. */
async function goAway(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.hasFocus = () => false;
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('blur'));
  });
  // The server hears window:state over the socket.
  await page.waitForTimeout(500);
}

const chatIdOf = (page: Page) => new URL(page.url()).pathname.split('/').at(-1) ?? '';

async function setMute(page: Page, chatId: string, mute: 'always' | 'off'): Promise<void> {
  const response = await page.request.patch(`/v1/chats/${chatId}/prefs`, { data: { mute } });
  expect(response.ok()).toBe(true);
}

test('B gets a push while away, none while muted or in Do Not Disturb', async ({ browser }) => {
  const asha = await newPerson(browser, 'Asha');
  const bharat = await newPerson(browser, 'Bharat');
  await openChatWith(asha.page, bharat);
  await send(asha.page, 'hello');
  await openFromList(bharat.page, 'Asha');
  await expectBubbles(bharat.page, 'Asha', ['hello']);
  const chatId = chatIdOf(bharat.page);
  await stubPush(bharat.page);
  await goAway(bharat.page);

  await send(asha.page, 'are you there?');
  await expect
    .poll(async () => (await pushesTo(asha.page, bharat)).map((push) => push.payload), SLOW)
    .toContainEqual(
      expect.objectContaining({
        kind: 'message',
        chatId,
        tag: `chat:${chatId}`,
        title: 'Asha',
        body: 'are you there?',
        hidden: false,
      }),
    );
  // Never to the sender's own devices.
  expect(await pushesTo(asha.page, asha)).toEqual([]);

  // Muted: nothing.
  const before = (await pushesTo(asha.page, bharat)).length;
  await setMute(bharat.page, chatId, 'always');
  await send(asha.page, 'muted one');
  await asha.page.waitForTimeout(QUIET_MS);
  expect(await pushesTo(asha.page, bharat)).toHaveLength(before);

  // Do Not Disturb on: nothing either.
  await setMute(bharat.page, chatId, 'off');
  const quiet = await bharat.page.request.get('/v1/me/quiet-hours');
  const { quietHours } = await quiet.json();
  const dnd = await bharat.page.request.put('/v1/me/quiet-hours', {
    data: { ...quietHours, mode: 'on', allowMentions: true, allowChatIds: [] },
  });
  expect(dnd.ok()).toBe(true);
  await send(asha.page, 'during quiet hours');
  await asha.page.waitForTimeout(QUIET_MS);
  expect(await pushesTo(asha.page, bharat)).toHaveLength(before);
});

test('an @mention reaches B in a muted group', async ({ browser }) => {
  const asha = await newPerson(browser, 'Asha');
  const bharat = await newPerson(browser, 'Bharat');
  await createGroup(asha.page, 'Design', [bharat]);
  const chatId = chatIdOf(asha.page);
  await stubPush(bharat.page);
  await setMute(bharat.page, chatId, 'always');
  await goAway(bharat.page);

  await send(asha.page, 'no mention here');
  await asha.page.waitForTimeout(QUIET_MS);
  expect(await pushesTo(asha.page, bharat)).toEqual([]);

  const box = asha.page.getByRole('textbox', { name: 'Write a message' });
  await box.click();
  await box.pressSequentially('please look @Bha');
  const picker = asha.page.getByRole('listbox', { name: 'Mention someone' });
  await expect(picker.getByRole('option', { name: 'Bharat' })).toBeVisible(SLOW);
  await box.press('Enter');
  await expect(box).toHaveValue('please look @Bharat ');
  await asha.page.getByRole('button', { name: 'Send' }).click();
  await expect
    .poll(async () => (await pushesTo(asha.page, bharat)).map((push) => push.payload), SLOW)
    .toContainEqual(
      expect.objectContaining({
        kind: 'message',
        chatId,
        title: 'Design',
        body: expect.stringContaining('Asha: please look @Bharat'),
      }),
    );
});

test('"Send test notification" reaches this device', async ({ browser }) => {
  const asha = await newPerson(browser, 'Asha');
  await stubPush(asha.page);
  // Firefox aborts a navigation that overlaps the chat list still loading: try again.
  await expect(async () => {
    await asha.page.goto('/settings/notifications');
  }).toPass(SLOW);
  await asha.page.getByRole('button', { name: 'Send test notification' }).click();
  // The stub, and the browser's own subscription where its push service answers.
  await expect(asha.page.getByText(/^Test notification sent to \d+ devices?\.$/)).toBeVisible(SLOW);
  const pushes = await pushesTo(asha.page, asha);
  expect(pushes.length).toBeGreaterThan(0);
  expect(pushes.every((push) => push.payload.kind === 'test')).toBe(true);
});
