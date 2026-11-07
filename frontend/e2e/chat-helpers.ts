import { type Browser, type BrowserContext, expect, type Page } from '@playwright/test';
import { SLOW, signIn, signUp } from './helpers';

export interface Person {
  context: BrowserContext;
  page: Page;
  name: string;
  username: string;
  email: string;
}

/** A new account in its own browser context: its own cookies and its own IndexedDB. */
export async function newPerson(browser: Browser, name: string): Promise<Person> {
  const context = await browser.newContext();
  const page = await context.newPage();
  // Random: tests in parallel workers start within the same millisecond.
  const username = `${name.toLowerCase()}${Math.random().toString(36).slice(2, 12)}`;
  const email = await signUp(page, name, username);
  return { context, page, name, username, email };
}

/** The same account on another device. */
export async function secondDevice(browser: Browser, person: Person): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, person.email);
  return page;
}

/** New chat → find the person → Enter. The chat opens at once. */
export async function openChatWith(page: Page, person: Person): Promise<void> {
  await page.getByRole('button', { name: 'New chat' }).click();
  const picker = page.getByRole('dialog', { name: 'New chat' });
  await picker.getByRole('combobox').fill(person.username);
  await expect(picker.getByRole('option')).toHaveCount(1, SLOW);
  await expect(picker.getByRole('option', { name: new RegExp(person.name) })).toBeVisible();
  await picker.getByRole('combobox').press('Enter');
  await expect(thread(page, person.name)).toBeAttached(SLOW);
}

export const thread = (page: Page, chatName: string) =>
  page.getByRole('list', { name: chatName, exact: true }).or(page.getByText(/^No messages yet\./));

/** Opens a chat from the list, on phones and on desktop alike. */
export async function openFromList(page: Page, chatName: string): Promise<void> {
  await page.getByRole('link', { name: new RegExp(chatName) }).click();
  await expect(page).toHaveURL(/\/chats\/[0-9a-f]{24}$/, SLOW);
}

/** Types and clicks Send: Enter only sends on desktop, the button works everywhere. */
export async function send(page: Page, text: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Write a message' }).fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
}

/** Message texts in the order shown. */
export const bubbles = (page: Page, chatName: string) =>
  page
    .getByRole('list', { name: chatName, exact: true })
    .locator('[data-formatted]')
    .allTextContents();

export async function expectBubbles(page: Page, chatName: string, texts: string[]): Promise<void> {
  await expect.poll(() => bubbles(page, chatName), SLOW).toEqual(texts);
}

/** Names of this page's Zuvo databases. */
export const localDatabases = (page: Page) =>
  page.evaluate(async () =>
    (await indexedDB.databases()).flatMap(({ name }) => (name?.startsWith('zuvo-') ? [name] : [])),
  );

/** Names of the Web Locks held in this browser context. */
export const heldLocks = (page: Page) =>
  page.evaluate(async () =>
    ((await navigator.locks.query()).held ?? []).flatMap(({ name }) => (name ? [name] : [])),
  );
