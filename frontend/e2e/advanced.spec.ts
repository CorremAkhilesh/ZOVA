import { expect, type Page, test } from '@playwright/test';
import {
  createGroup,
  newPerson,
  openChatWith,
  openFromList,
  secondDevice,
  send,
  thread,
} from './chat-helpers';
import { SLOW } from './helpers';

test.describe.configure({ timeout: 300_000 });
test.use({ actionTimeout: 30_000 });

const composer = (page: Page) => page.getByRole('textbox', { name: 'Write a message' });

/** The chat list, wherever the person is: on a phone it is a screen of its own. */
async function toList(page: Page) {
  await page.goto('/chats');
  await expect(page.getByRole('heading', { name: 'Chats', exact: true })).toBeVisible(SLOW);
}

test('a "Work" folder with a group counts its unread chats', async ({ browser }) => {
  const asha = await newPerson(browser, 'Asha');
  const bharat = await newPerson(browser, 'Bharat');
  await createGroup(asha.page, 'Standup', [bharat]);
  await send(asha.page, 'kick-off at 10');

  // B makes a folder from the "+" chip and picks the group.
  await toList(bharat.page);
  await expect(bharat.page.getByRole('link', { name: /Standup/ })).toBeVisible(SLOW);
  await openFromList(bharat.page, 'Standup');
  await toList(bharat.page);
  await bharat.page.getByRole('button', { name: 'New folder' }).click();
  const editor = bharat.page.getByRole('dialog', { name: 'New folder' });
  await editor.getByRole('textbox', { name: 'Name' }).fill('Work');
  await editor.getByRole('checkbox', { name: /Standup/ }).check();
  await editor.getByRole('button', { name: 'Create folder' }).click();
  const work = bharat.page.getByRole('tab', { name: 'Work' });
  await expect(work).toBeVisible(SLOW);

  // A new message in the group: the chip counts one chat with something unread.
  await send(asha.page, 'who is presenting?');
  await expect(work).toHaveAccessibleDescription('1 chat with unread messages', SLOW);
  await work.click();
  await expect(bharat.page.getByRole('link', { name: /Standup/ })).toBeVisible();
});

test('pinning a message shows it under the header, and a tap jumps to it', async ({ browser }) => {
  const asha = await newPerson(browser, 'Asha');
  const bharat = await newPerson(browser, 'Bharat');
  await openChatWith(asha.page, bharat);
  await send(asha.page, 'agenda for friday');
  for (const n of [1, 2, 3]) await send(asha.page, `chat ${n}`);

  const agenda = thread(asha.page, 'Bharat').getByText('agenda for friday', { exact: true });
  await agenda.click({ button: 'right' });
  await asha.page
    .getByRole('menu', { name: 'Message actions' })
    .getByRole('menuitem', { name: 'Pin' })
    .click();
  const dialog = asha.page.getByRole('dialog', { name: 'Pin for everyone' });
  await dialog.getByRole('radio', { name: '7 days' }).check();
  await dialog.getByRole('button', { name: 'Pin' }).click();

  await openFromList(bharat.page, 'Asha');
  await expect(thread(bharat.page, 'Asha').getByText('Asha pinned a message')).toBeVisible(SLOW);
  const bar = bharat.page.getByRole('button', { name: 'Go to pinned message 1 of 1' });
  await expect(bar).toContainText('agenda for friday', SLOW);
  await bar.click();
  await expect(
    thread(bharat.page, 'Asha').getByText('agenda for friday', { exact: true }),
  ).toBeInViewport();
});

test('an @mention gives B an "@" in the list and a button that jumps to it', async ({
  browser,
}) => {
  const asha = await newPerson(browser, 'Asha');
  const bharat = await newPerson(browser, 'Bharat');
  await createGroup(asha.page, 'Design', [bharat]);

  const box = composer(asha.page);
  await box.click();
  await box.pressSequentially('can you check this @Bha');
  const picker = asha.page.getByRole('listbox', { name: 'Mention someone' });
  await expect(picker.getByRole('option', { name: 'Bharat' })).toBeVisible(SLOW);
  await box.press('Enter');
  await expect(box).toHaveValue('can you check this @Bharat ');
  await asha.page.getByRole('button', { name: 'Send' }).click();
  // More after it, so the mention is out of sight when B opens the chat.
  for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) await send(asha.page, `update ${n}`);

  await toList(bharat.page);
  await expect(bharat.page.getByLabel('1 message mentions you')).toBeVisible(SLOW);
  await openFromList(bharat.page, 'Design');
  await bharat.page.getByRole('button', { name: 'Go to the message that mentions you' }).click();
  const mention = thread(bharat.page, 'Design').getByRole('button', { name: '@Bharat' });
  await expect(mention).toBeInViewport(SLOW);
  await mention.click();
  await expect(bharat.page.getByRole('dialog', { name: 'Profile' })).toContainText('Bharat', SLOW);
});

test('a draft typed on one device shows on the other', async ({ browser }) => {
  const asha = await newPerson(browser, 'Asha');
  const bharat = await newPerson(browser, 'Bharat');
  await openChatWith(asha.page, bharat);
  await send(asha.page, 'hello');
  const other = await secondDevice(browser, asha);

  await composer(asha.page).fill('see you at five');
  await toList(other);
  await expect(other.getByRole('link', { name: /Bharat/ })).toContainText(
    'Draft: see you at five',
    SLOW,
  );
  await openFromList(other, 'Bharat');
  await expect(composer(other)).toHaveValue('see you at five', SLOW);

  // Sent from the first device: gone from the second.
  await asha.page.getByRole('button', { name: 'Send' }).click();
  await toList(other);
  await expect(other.getByRole('link', { name: /Bharat/ })).not.toContainText('Draft:', SLOW);
});

test('"Toggle theme" runs from the command palette', async ({ browser }) => {
  const asha = await newPerson(browser, 'Asha');
  const page = asha.page;
  const html = page.locator('html');
  const before = (await html.getAttribute('data-theme')) ?? 'light';
  await page.keyboard.press('Control+k');
  const box = page.getByRole('combobox', { name: /Search chats/ });
  await box.fill('>togl thm');
  await expect(page.getByRole('option', { name: /Toggle theme/ })).toBeVisible();
  await box.press('Enter');
  await expect(html).toHaveAttribute('data-theme', before === 'dark' ? 'light' : 'dark');
});
