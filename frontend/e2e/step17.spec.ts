import { expect, type Page, test } from '@playwright/test';
import {
  createGroup,
  expectBubbles,
  newPerson,
  openChatWith,
  openFromList,
  type Person,
  send,
  thread,
} from './chat-helpers';
import { SLOW } from './helpers';

test.describe.configure({ timeout: 360_000 });
test.use({ actionTimeout: 30_000 });

const composer = (page: Page) => page.getByRole('textbox', { name: 'Write a message' });
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAEklEQVR4nGNk+M+ABIwMDAwAFAoBAX1Nz8QAAAAASUVORK5CYII=',
  'base64',
);

/** A and B in a 1:1 chat, each with it open. */
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

/** Escape until the composer shows: on a phone, chat info is a dialog over the chat. */
async function closeOverlays(page: Page) {
  for (let i = 0; i < 3 && !(await composer(page).isVisible()); i += 1) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  await expect(composer(page)).toBeVisible(SLOW);
}

const chatIdOf = (page: Page) => new URL(page.url()).pathname.split('/').at(-1) ?? '';

/** Chat info, on a phone a dialog of its own. */
async function chatInfo(page: Page) {
  const pane = page
    .getByRole('complementary', { name: 'Chat info' })
    .or(page.getByRole('dialog', { name: 'Chat info' }));
  if (!(await pane.isVisible()))
    await page.getByRole('button', { name: 'Chat info' }).first().click();
  await expect(pane).toBeVisible(SLOW);
  return pane;
}

test('a message scheduled a minute ahead arrives on its own', async ({ browser }) => {
  const [asha, bharat] = await chatting(browser);
  await composer(asha.page).fill('scheduled hello');
  await asha.page.getByRole('button', { name: 'Send', exact: true }).click({ button: 'right' });
  await asha.page.getByRole('button', { name: 'Schedule message' }).click();
  const dialog = asha.page.getByRole('dialog', { name: 'Schedule message' });
  // Two minutes ahead at most, in the browser's own time zone, as the picker shows it.
  const { date, time } = await asha.page.evaluate(() => {
    const at = new Date(Date.now() + 120_000);
    const pad = (n: number) => String(n).padStart(2, '0');
    return {
      date: `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`,
      time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
    };
  });
  await dialog.getByLabel('Date').fill(date);
  await dialog.getByLabel('Time').fill(time);
  await dialog.getByRole('button', { name: 'Schedule', exact: true }).click();
  await expect(dialog).toBeHidden(SLOW);
  await expect(asha.page.getByRole('button', { name: '1 scheduled message' })).toBeVisible(SLOW);
  // Not yet. Then its time comes: a test-only hook makes it due now and runs the server's sweep,
  // the same send the timer makes (the timer itself has backend tests), so nobody waits 2 minutes.
  await expect(thread(bharat.page, 'Asha').getByText('scheduled hello')).toHaveCount(0);
  const response = await asha.page.request.post('/v1/test/run-scheduled', {
    data: { chatId: chatIdOf(asha.page) },
  });
  expect(await response.json()).toEqual({ sent: 1 });
  await expect(thread(bharat.page, 'Asha').getByText('scheduled hello')).toBeVisible(SLOW);
  await expect(thread(asha.page, 'Bharat').getByText('scheduled hello')).toBeVisible(SLOW);
  await expect(asha.page.getByRole('button', { name: '1 scheduled message' })).toHaveCount(0, SLOW);
});

test('a poll: B votes and A sees the result', async ({ browser }) => {
  const asha = await newPerson(browser, 'Asha');
  const bharat = await newPerson(browser, 'Bharat');
  await createGroup(asha.page, 'Lunch', [bharat]);
  await asha.page.getByRole('button', { name: 'Attach a file' }).click();
  await asha.page
    .getByRole('menuitem', { name: 'Poll' })
    .or(asha.page.getByRole('button', { name: 'Poll' }))
    .first()
    .click();
  const dialog = asha.page.getByRole('dialog', { name: 'Create poll' });
  await dialog.getByRole('textbox', { name: 'Question' }).fill('Where shall we eat?');
  await dialog.getByRole('textbox', { name: 'Option 1' }).fill('Dosa place');
  await dialog.getByRole('textbox', { name: 'Option 2' }).fill('Pizza place');
  await dialog.getByRole('button', { name: 'Send poll' }).click();
  await expect(dialog).toBeHidden(SLOW);

  await bharat.page.goto('/chats');
  await expect(bharat.page.getByRole('link', { name: /Lunch/ })).toContainText(
    'Poll: Where shall we eat?',
    SLOW,
  );
  await openFromList(bharat.page, 'Lunch');
  await thread(bharat.page, 'Lunch')
    .getByRole('radio', { name: /Dosa place/ })
    .click();
  await expect(
    thread(asha.page, 'Lunch').getByRole('radio', { name: /Dosa place, 1 vote, 100 percent/ }),
  ).toBeAttached(SLOW);
});

test('disappearing messages: 24 hours, then gone for both when their time is up', async ({
  browser,
}) => {
  const [asha, bharat] = await chatting(browser);
  const pane = await chatInfo(asha.page);
  await pane.getByRole('button', { name: /^Disappearing messages/ }).click();
  await asha.page.getByRole('radio', { name: '24 hours' }).click();
  await expect(
    thread(bharat.page, 'Asha').getByText(/turned on disappearing messages/),
  ).toBeVisible(SLOW);
  await closeOverlays(asha.page);
  await send(asha.page, 'gone tomorrow');
  await expect(thread(bharat.page, 'Asha').getByText('gone tomorrow')).toBeVisible(SLOW);
  await expect(
    thread(bharat.page, 'Asha').getByLabel('Disappearing message').first(),
  ).toBeAttached();

  // A test-only hook makes them due now (the server has no clock to move forward).
  const response = await asha.page.request.post('/v1/test/expire-messages', {
    data: { chatId: chatIdOf(asha.page) },
  });
  expect(response.ok()).toBe(true);
  await expect(thread(bharat.page, 'Asha').getByText('gone tomorrow')).toHaveCount(0, SLOW);
  await expect(thread(asha.page, 'Asha').getByText('gone tomorrow')).toHaveCount(0, SLOW);
  await expect(thread(asha.page, 'Bharat').getByText('gone tomorrow')).toHaveCount(0, SLOW);
});

test('a view-once photo opens once, then shows "Opened"', async ({ browser }) => {
  const [asha, bharat] = await chatting(browser);
  await asha.page.getByRole('button', { name: 'Attach a file' }).click();
  await asha.page.getByTestId('pick-media').setInputFiles({
    name: 'secret.png',
    mimeType: 'image/png',
    buffer: PNG,
  });
  const sheet = asha.page.getByRole('dialog', { name: /^Send/ });
  await sheet.getByRole('button', { name: 'View once' }).click();
  await expect(sheet.getByRole('button', { name: 'View once' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await sheet.getByRole('button', { name: /^Send/ }).last().click();
  await expect(sheet).toBeHidden(SLOW);

  const bubble = thread(bharat.page, 'Asha').getByRole('button', { name: 'Open view-once photo' });
  await expect(bubble).toBeVisible(SLOW);
  await bubble.click();
  const viewer = bharat.page.getByRole('dialog', { name: 'View-once photo' });
  await expect(viewer).toBeVisible(SLOW);
  await expect(viewer).toContainText('Screenshots can’t be blocked in a browser.');
  await bharat.page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();
  await expect(thread(bharat.page, 'Asha').getByText('Opened')).toBeVisible(SLOW);
  await expect(bubble).toHaveCount(0);
  // The sender learns it was opened.
  await expect(thread(asha.page, 'Bharat').getByText('Opened')).toBeVisible(SLOW);
});

test('a locked chat leaves the list and opens with the PIN', async ({ browser }) => {
  const [asha] = await chatting(browser);
  const page = asha.page;
  await page.goto('/settings/privacy');
  await page.getByRole('button', { name: 'Set PIN' }).click();
  const setup = page.getByRole('dialog', { name: 'Set PIN' });
  await expect(setup).toBeVisible(SLOW);
  await expect(setup.getByRole('group').first()).toBeFocused(SLOW);
  await page.keyboard.type('2580');
  await page.keyboard.press('Enter');
  await page.keyboard.type('2580');
  await page.keyboard.press('Enter');
  await expect(setup).toBeHidden(SLOW);

  await page.goto('/chats');
  await page.getByRole('link', { name: /Bharat/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Lock chat' }).click();
  await expect(page.getByRole('link', { name: /Bharat/ })).toHaveCount(0, SLOW);
  const entry = page.getByRole('button', { name: /Locked chats/ });
  await expect(entry).toBeVisible();
  await entry.click();
  // The PIN pad loads on demand: type once it has the focus.
  await expect(page.getByRole('group', { name: 'Enter your PIN' })).toBeFocused(SLOW);
  await page.keyboard.type('2580');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: /Bharat/ })).toBeVisible(SLOW);
  // Still no message text while unlocked.
  await expect(page.getByRole('link', { name: /Bharat/ })).not.toContainText('hello');
  await page.getByRole('link', { name: /Bharat/ }).click();
  await expect(thread(page, 'Bharat').getByText('hello')).toBeVisible(SLOW);
});

test('changing the accent colour applies everywhere at once', async ({ browser }) => {
  const asha = await newPerson(browser, 'Asha');
  const page = asha.page;
  // Let the chat list finish loading first: Firefox aborts a navigation that overlaps another.
  await expect(page.getByRole('button', { name: 'New chat' })).toBeVisible(SLOW);
  await expect(async () => {
    await page.goto('/settings/appearance');
  }).toPass(SLOW);
  const teal = page.getByRole('radio', { name: 'Teal' });
  await teal.click();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'teal');
  const brand = () =>
    page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--color-brand'),
    );
  const before = await brand();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'teal');
  expect(await brand()).toBe(before);
  await page.getByRole('radio', { name: 'Indigo' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-accent', 'indigo');
  expect(await brand()).not.toBe(before);
});
