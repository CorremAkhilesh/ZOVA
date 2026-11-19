import { expect, type Page, test } from '@playwright/test';
import {
  expectBubbles,
  expectSent,
  messageMenu,
  newPerson,
  openChatWith,
  openFromList,
  type Person,
  send,
} from './chat-helpers';
import { SLOW } from './helpers';

// Delete, as WhatsApp does it: for everyone (the other person sees it go at once), for me (with
// Undo), and a message that was never sent (removed from this device only).

test.describe.configure({ timeout: 240_000 });

const thread = (page: Page, name: string) => page.getByRole('list', { name, exact: true });

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

test('delete for everyone: the other person sees "This message was deleted" at once', async ({
  browser,
}) => {
  const [asha, bharat] = await chatting(browser);
  await send(asha.page, 'oops, wrong chat');
  await expect(thread(bharat.page, 'Asha').getByText('oops, wrong chat')).toBeVisible(SLOW);

  const menu = await messageMenu(asha.page, 'Bharat', 'oops, wrong chat');
  await menu.getByRole('menuitem', { name: 'Delete' }).click();
  await asha.page
    .getByRole('dialog', { name: 'Delete this message?' })
    .getByRole('button', { name: 'Delete for everyone' })
    .click();

  for (const [page, name] of [
    [asha.page, 'Bharat'],
    [bharat.page, 'Asha'],
  ] as const) {
    await expect(thread(page, name).getByText('This message was deleted')).toBeVisible(SLOW);
    await expect(thread(page, name).getByText('oops, wrong chat')).toHaveCount(0);
  }
  // The chat list says so too, on the other side.
  await bharat.page.goto('/chats');
  await expect(bharat.page.getByRole('link', { name: /Asha/ })).toContainText(
    'This message was deleted',
    SLOW,
  );
  await asha.context.close();
  await bharat.context.close();
});

test('delete for me: Undo brings it back; otherwise it stays gone, for me only', async ({
  browser,
}) => {
  const [asha, bharat] = await chatting(browser);
  await send(bharat.page, 'just for Asha to hide');
  await expect(thread(asha.page, 'Bharat').getByText('just for Asha to hide')).toBeVisible(SLOW);

  const remove = async () => {
    await thread(asha.page, 'Bharat')
      .getByText('just for Asha to hide', { exact: true })
      .click({ button: 'right' });
    await asha.page
      .getByRole('menu', { name: 'Message actions' })
      .getByRole('menuitem', { name: 'Delete' })
      .click();
    await asha.page
      .getByRole('dialog', { name: 'Delete this message?' })
      .getByRole('button', { name: 'Delete for me' })
      .click();
    await expect(thread(asha.page, 'Bharat').getByText('just for Asha to hide')).toHaveCount(0);
  };

  await remove();
  await asha.page.getByRole('button', { name: 'Undo' }).click();
  await expect(thread(asha.page, 'Bharat').getByText('just for Asha to hide')).toBeVisible();

  await remove();
  await expect(asha.page.getByText('Message deleted for you')).toBeVisible();
  await asha.page.waitForTimeout(6500);
  await asha.page.reload();
  await expectBubbles(asha.page, 'Bharat', ['hello']);
  // Bharat still has it.
  await expect(thread(bharat.page, 'Asha').getByText('just for Asha to hide')).toBeVisible();
  await asha.context.close();
  await bharat.context.close();
});

test('a message that was never sent can be deleted, from this device only', async ({ browser }) => {
  const [asha, bharat] = await chatting(browser);
  await asha.context.setOffline(true);
  await send(asha.page, 'typed while offline');
  const row = thread(asha.page, 'Bharat').getByText('typed while offline', { exact: true });
  await expect(row).toBeVisible();

  await row.click({ button: 'right' });
  const menu = asha.page.getByRole('menu', { name: 'Message actions' });
  await expect(menu.getByRole('menuitem')).toHaveText(['Delete']);
  await menu.getByRole('menuitem', { name: 'Delete' }).click();
  const dialog = asha.page.getByRole('dialog', { name: 'Delete this message?' });
  await expect(dialog).toContainText('never sent');
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(row).toHaveCount(0);

  // Back online: nothing goes out, on either side.
  await asha.context.setOffline(false);
  await send(asha.page, 'back online');
  await expectSent(asha.page, 'Bharat', 'back online');
  await expectBubbles(bharat.page, 'Asha', ['hello', 'back online']);
  await asha.context.close();
  await bharat.context.close();
});
