import { type Browser, expect, type Page } from '@playwright/test';
import { createGroup, openChatWith, openFromList, type Person, send } from '../chat-helpers';
import { SLOW, signUp } from '../helpers';

/** A small valid PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAEklEQVR4nGNk+M+ABIwMDAwAFAoBAX1Nz8QAAAAASUVORK5CYII=',
  'base64',
);

export const LONG_NAME = 'Asha Venkataraman-Subramaniam Krishnamurthy';
export const GROUP_NAME = 'Quarterly planning — Finance & Operations team (Mumbai office)';

const LONG_MESSAGE = [
  'Here is the full plan for next quarter, so everyone has it in one place before Monday.',
  'First, the budget review moves to the 14th because the auditors need two more days with the ledgers, and the vendor contracts for the new office still have to be signed by legal.',
  'Second, please send your team targets by Friday evening; I will merge them into the shared sheet and circulate a summary.',
  'Reference: INV-2026-11-000000000000000000000000000000000000000000000042-FINAL-REVISED-v3',
].join('\n\n');

const HINDI_MESSAGE = 'नमस्ते! कल की मीटिंग 11 बजे है। कृपया अपनी रिपोर्ट आज शाम तक भेज दें। 🙏';

async function person(browser: Browser, name: string, prefix: string): Promise<Person> {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  await context.addInitScript(() => {
    try {
      localStorage.setItem('zuvo.push.card-dismissed', '1');
    } catch {
      // No storage: the card may show.
    }
  });
  const page = await context.newPage();
  const username = `${prefix}${Math.random().toString(36).slice(2, 10)}`;
  const email = await signUp(page, name, username);
  return { context, page, name, username, email };
}

async function sendPhoto(page: Page) {
  await page.getByRole('button', { name: 'Attach a file' }).click();
  await page
    .getByTestId('pick-media')
    .setInputFiles({ name: 'whiteboard.png', mimeType: 'image/png', buffer: PNG });
  const sheet = page.getByRole('dialog', { name: /^Send/ });
  await sheet.getByRole('button', { name: /^Send/ }).last().click();
  await expect(sheet).toBeHidden(SLOW);
}

async function sendPoll(page: Page) {
  await page.getByRole('button', { name: 'Attach a file' }).click();
  await page
    .getByRole('menuitem', { name: 'Poll' })
    .or(page.getByRole('button', { name: 'Poll' }))
    .first()
    .click();
  const dialog = page.getByRole('dialog', { name: 'Create poll' });
  await dialog.getByRole('textbox', { name: 'Question' }).fill('Where shall we hold the offsite?');
  await dialog.getByRole('textbox', { name: 'Option 1' }).fill('Lonavala resort');
  await dialog.getByRole('textbox', { name: 'Option 2' }).fill('Office terrace');
  await dialog.getByRole('button', { name: 'Send poll' }).click();
  await expect(dialog).toBeHidden(SLOW);
}

export interface Seeded {
  asha: Person;
  directId: string;
  groupId: string;
}

/** Three people, a 1:1 chat with long, Hindi and photo messages, and a group with a poll. */
export async function seed(browser: Browser): Promise<Seeded> {
  const asha = await person(browser, LONG_NAME, 'asha');
  const bharat = await person(browser, 'Bharat Mehta', 'bharat');
  const chitra = await person(browser, 'Chitra Iyer', 'chitra');

  await openChatWith(asha.page, bharat);
  const directId = new URL(asha.page.url()).pathname.split('/').at(-1) ?? '';
  await send(asha.page, 'Good morning! Did you get a chance to look at the numbers?');
  await expect(bharat.page.getByRole('link', { name: /Asha/ })).toBeVisible(SLOW);
  await openFromList(bharat.page, 'Asha');
  await send(bharat.page, 'Yes, looks good. A few questions on travel costs.');
  await send(bharat.page, HINDI_MESSAGE);
  await send(asha.page, LONG_MESSAGE);
  await sendPhoto(asha.page);
  await send(bharat.page, 'Thanks, *noted*. I will reply by `EOD`.');

  await asha.page.goto('/chats');
  await createGroup(asha.page, GROUP_NAME, [bharat, chitra]);
  const groupId = new URL(asha.page.url()).pathname.split('/').at(-1) ?? '';
  await send(asha.page, 'Welcome everyone — agenda is pinned below.');
  await sendPoll(asha.page);
  await openFromList(chitra.page, 'Quarterly');
  await send(chitra.page, 'Thanks Asha! I vote for the terrace 😄');

  await bharat.context.close();
  await chitra.context.close();
  return { asha, directId, groupId };
}
