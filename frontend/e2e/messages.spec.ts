import { expect, type Page, test } from '@playwright/test';
import { newPerson, openChatWith, openFromList, send, thread } from './chat-helpers';
import { SLOW } from './helpers';

test.describe.configure({ timeout: 300_000 });
// Something stuck should fail with a reason, and not use up the whole job.
test.use({ actionTimeout: 30_000 });

const bubble = (page: Page, chat: string, text: string) =>
  thread(page, chat).getByText(text, { exact: true });

/** Right click on a desktop, a long press on a phone. */
async function menuOn(page: Page, chat: string, text: string) {
  const target = bubble(page, chat, text);
  await expect(target).toBeVisible(SLOW);
  await target.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Message actions' });
  await expect(menu).toBeVisible();
  return menu;
}

async function chatMenu(page: Page, name: string) {
  await page.getByRole('link', { name: new RegExp(name) }).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: `Actions for ${name}` });
  await expect(menu).toBeVisible();
  return menu;
}

test('message actions between two people: reply, edit, react, delete', async ({ browser }) => {
  const asha = await newPerson(browser, 'Asha');
  const bharat = await newPerson(browser, 'Bharat');
  await openChatWith(asha.page, bharat);
  await send(asha.page, 'first from asha');
  await openFromList(bharat.page, 'Asha');
  await expect(bubble(bharat.page, 'Asha', 'first from asha')).toBeVisible(SLOW);
  await send(bharat.page, 'answer from bharat');
  await expect(bubble(asha.page, 'Bharat', 'answer from bharat')).toBeVisible(SLOW);

  // A replies to B's message, and B jumps to it.
  await (await menuOn(asha.page, 'Bharat', 'answer from bharat'))
    .getByRole('menuitem', { name: 'Reply' })
    .click();
  await expect(asha.page.getByRole('button', { name: 'Cancel reply' })).toBeVisible();
  await send(asha.page, 'this is my reply');
  const quote = bharat.page.getByRole('button', { name: /Go to the message from/ });
  await expect(quote).toBeVisible(SLOW);
  await quote.click();
  await expect(bharat.page.locator('[data-seq="2"]')).toHaveClass(/bg-brand/);

  // A edits within 15 minutes, and B sees "edited".
  await (await menuOn(asha.page, 'Bharat', 'this is my reply'))
    .getByRole('menuitem', { name: 'Edit' })
    .click();
  const composer = asha.page.getByRole('textbox', { name: 'Write a message' });
  await expect(composer).toHaveValue('this is my reply');
  await composer.fill('this is my edited reply');
  // Enter makes a new line on a phone: the button sends everywhere.
  await asha.page.getByRole('button', { name: 'Send' }).click();
  await expect(bubble(bharat.page, 'Asha', 'this is my edited reply')).toBeVisible(SLOW);
  await expect(thread(bharat.page, 'Asha').getByText('edited', { exact: true })).toBeVisible();

  // B reacts, A sees it, and tapping shows who.
  await (await menuOn(bharat.page, 'Asha', 'first from asha'))
    .getByRole('menuitem', { name: '👍' })
    .click();
  const pill = asha.page.getByRole('button', { name: /👍, 1/ });
  await expect(pill).toBeVisible(SLOW);
  await pill.click();
  const who = asha.page.getByRole('dialog', { name: 'Reactions' });
  await expect(who).toContainText('Bharat');
  await asha.page.keyboard.press('Escape');

  // A deletes for everyone, and B sees the tombstone.
  await (await menuOn(asha.page, 'Bharat', 'this is my edited reply'))
    .getByRole('menuitem', { name: 'Delete' })
    .click();
  await asha.page.getByRole('button', { name: 'Delete for everyone' }).click();
  await expect(
    thread(bharat.page, 'Asha').getByText('This message was deleted', { exact: true }),
  ).toBeVisible(SLOW);
  await expect(bubble(bharat.page, 'Asha', 'this is my edited reply')).toHaveCount(0);

  await asha.context.close();
  await bharat.context.close();
});

test('forward to two chats, star and find it, and chat menus', async ({ browser, isMobile }) => {
  test.skip(isMobile, 'Right click is a desktop gesture; long press has unit tests.');
  const asha = await newPerson(browser, 'Asha');
  const bharat = await newPerson(browser, 'Bharat');
  const chitra = await newPerson(browser, 'Chitra');
  await openChatWith(asha.page, chitra);
  await send(asha.page, 'hello chitra');
  await openChatWith(asha.page, bharat);
  await send(asha.page, 'worth sharing');

  await (await menuOn(asha.page, 'Bharat', 'worth sharing'))
    .getByRole('menuitem', { name: 'Forward' })
    .click();
  const dialog = asha.page.getByRole('dialog', { name: 'Forward to' });
  await dialog.getByRole('button', { name: /Chitra/ }).click();
  await dialog.getByRole('button', { name: /Saved Messages/ }).click();
  await dialog.getByRole('button', { name: 'Forward', exact: true }).click();
  await openFromList(chitra.page, 'Asha');
  await expect(bubble(chitra.page, 'Asha', 'worth sharing')).toBeVisible(SLOW);
  await expect(thread(chitra.page, 'Asha').getByText('Forwarded', { exact: true })).toBeVisible();

  await (await menuOn(asha.page, 'Bharat', 'worth sharing'))
    .getByRole('menuitem', { name: 'Star' })
    .click();
  await asha.page.getByRole('link', { name: 'Starred messages' }).click();
  await expect(asha.page.getByRole('list', { name: 'Starred messages' })).toContainText(
    'worth sharing',
    SLOW,
  );
  await asha.page.getByRole('button', { name: /Open this message in Bharat/ }).click();
  await expect(bubble(asha.page, 'Bharat', 'worth sharing')).toBeVisible(SLOW);

  await (await chatMenu(asha.page, 'Chitra')).getByRole('menuitem', { name: 'Pin chat' }).click();
  await expect(asha.page.getByRole('img', { name: 'Pinned' })).toBeVisible();
  await (await chatMenu(asha.page, 'Chitra'))
    .getByRole('menuitem', { name: 'Mute always' })
    .click();
  await expect(asha.page.getByRole('img', { name: 'Muted' })).toBeVisible();
  await (await chatMenu(asha.page, 'Chitra'))
    .getByRole('menuitem', { name: 'Archive chat' })
    .click();
  const archived = asha.page.getByRole('button', { name: /Archived/ });
  await expect(archived).toBeVisible();
  await expect(asha.page.getByRole('link', { name: /Chitra/ })).toHaveCount(0);
  await send(chitra.page, 'still there?');
  await archived.click();
  await expect(asha.page.getByRole('link', { name: /Chitra/ })).toContainText('still there?', SLOW);

  await asha.context.close();
  await bharat.context.close();
  await chitra.context.close();
});

test('an edit and a reaction made offline reach the other person after reconnecting', async ({
  browser,
  isMobile,
}) => {
  test.skip(isMobile, 'Right click is a desktop gesture; the queue itself has unit tests.');
  const asha = await newPerson(browser, 'Asha');
  const bharat = await newPerson(browser, 'Bharat');
  await openChatWith(asha.page, bharat);
  await send(asha.page, 'typed online');
  await openFromList(bharat.page, 'Asha');
  await send(bharat.page, 'hello from bharat');
  await expect(bubble(asha.page, 'Bharat', 'hello from bharat')).toBeVisible(SLOW);

  await asha.context.setOffline(true);
  await (await menuOn(asha.page, 'Bharat', 'typed online'))
    .getByRole('menuitem', { name: 'Edit' })
    .click();
  const composer = asha.page.getByRole('textbox', { name: 'Write a message' });
  await composer.fill('changed offline');
  // Enter makes a new line on a phone: the button sends everywhere.
  await asha.page.getByRole('button', { name: 'Send' }).click();
  await expect(bubble(asha.page, 'Bharat', 'changed offline')).toBeVisible();
  await (await menuOn(asha.page, 'Bharat', 'hello from bharat'))
    .getByRole('menuitem', { name: '❤️' })
    .click();
  await expect(asha.page.getByRole('button', { name: /❤️, 1/ })).toBeVisible();
  // Nothing has gone anywhere yet.
  await expect(bubble(bharat.page, 'Asha', 'typed online')).toBeVisible();

  await asha.context.setOffline(false);
  await expect(bubble(bharat.page, 'Asha', 'changed offline')).toBeVisible(SLOW);
  await expect(bharat.page.getByRole('button', { name: /❤️, 1/ })).toBeVisible(SLOW);

  await asha.context.close();
  await bharat.context.close();
});
