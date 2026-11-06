import { expect, type Page, test } from '@playwright/test';
import { expectBubbles, newPerson, type Person, send } from './chat-helpers';
import { SLOW } from './helpers';

test.describe.configure({ timeout: 300_000 });

const thread = (page: Page, name: string) => page.getByRole('list', { name, exact: true });

/** The chat list, wherever the person is. On a phone it is a screen of its own. */
async function openGroupFromList(page: Page, name: string) {
  await page.goto('/chats');
  await page.getByRole('link', { name: new RegExp(name) }).click();
  await expect(page.getByRole('heading', { name })).toBeAttached(SLOW);
}

async function createGroup(page: Page, name: string, members: Person[]) {
  await page.getByRole('button', { name: 'New chat' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'New group' }).click();
  const dialog = page.getByRole('dialog', { name: 'New group' });
  for (const member of members) {
    await dialog.getByRole('searchbox').fill(member.username);
    await dialog.getByRole('button', { name: new RegExp(`@${member.username}`) }).click();
    await expect(dialog.getByRole('list', { name: 'Selected people' })).toContainText(member.name);
  }
  await dialog.getByRole('button', { name: 'Next' }).click();
  const details = page.getByRole('dialog', { name: 'Name your group' });
  await details.getByRole('textbox', { name: 'Group name' }).fill(name);
  await details.getByRole('button', { name: 'Create group' }).click();
  await expect(page.getByRole('heading', { name })).toBeAttached(SLOW);
}

const info = async (page: Page) => {
  const pane = page
    .getByRole('complementary', { name: 'Chat info' })
    .or(page.getByRole('dialog', { name: 'Chat info' }));
  if (!(await pane.isVisible())) {
    await page.getByRole('button', { name: 'Chat info' }).first().click();
  }
  await expect(pane).toBeVisible(SLOW);
  return pane;
};

const closeInfo = async (page: Page) => {
  const close = page.getByRole('button', { name: 'Close chat info' });
  if (await close.isVisible()) await close.click();
  else await page.keyboard.press('Escape');
};

test('a group from creation to announcement mode, with four people', async ({ browser }) => {
  const asha = await newPerson(browser, 'Asha');
  const bharat = await newPerson(browser, 'Bharat');
  const chitra = await newPerson(browser, 'Chitra');
  const dinesh = await newPerson(browser, 'Dinesh');

  // A creates a group with B and C.
  await createGroup(asha.page, 'Launch', [bharat, chitra]);
  await expect(thread(asha.page, 'Launch').getByText('You created the group “Launch”')).toBeVisible(
    SLOW,
  );
  await openGroupFromList(bharat.page, 'Launch');
  await openGroupFromList(chitra.page, 'Launch');

  // All three chat in real time, with sender names.
  await send(asha.page, 'hello everyone');
  await expectBubbles(bharat.page, 'Launch', ['hello everyone']);
  await send(bharat.page, 'hi from B');
  await expectBubbles(chitra.page, 'Launch', ['hello everyone', 'hi from B']);
  await expect(thread(chitra.page, 'Launch').getByText('Bharat', { exact: true })).toBeVisible(
    SLOW,
  );
  await send(chitra.page, 'hi from C');
  await expectBubbles(asha.page, 'Launch', ['hello everyone', 'hi from B', 'hi from C']);

  // A makes C admin.
  const pane = await info(asha.page);
  await pane.getByRole('button', { name: 'Actions for Chitra' }).click();
  await pane.getByRole('button', { name: 'Make admin' }).click();
  await closeInfo(asha.page);
  await expect(thread(chitra.page, 'Launch').getByText('Asha made you an admin')).toBeVisible(SLOW);

  // C renames the group, and everyone sees it.
  const chitraPane = await info(chitra.page);
  await chitraPane.getByRole('button', { name: 'Edit Group name' }).click();
  await chitraPane.getByRole('textbox', { name: 'Group name' }).fill('Launch crew');
  await chitraPane.getByRole('button', { name: 'Save' }).click();
  await expect(asha.page.getByRole('heading', { name: 'Launch crew' })).toBeAttached(SLOW);
  await expect(bharat.page.getByRole('heading', { name: 'Launch crew' })).toBeAttached(SLOW);
  await closeInfo(chitra.page);

  // B leaves, and sees no new messages.
  const bharatPane = await info(bharat.page);
  await bharatPane.getByRole('button', { name: 'Exit group' }).click();
  await bharat.page
    .getByRole('dialog', { name: 'Exit this group?' })
    .getByRole('button', { name: 'Exit group' })
    .click();
  await expect(bharat.page.getByText('You’re no longer a member of this group')).toBeVisible(SLOW);
  await closeInfo(bharat.page);
  await expect(thread(asha.page, 'Launch crew').getByText('Bharat left')).toBeVisible(SLOW);
  await send(asha.page, 'after B left');
  await expectBubbles(chitra.page, 'Launch crew', [
    'hello everyone',
    'hi from B',
    'hi from C',
    'after B left',
  ]);
  await bharat.page.waitForTimeout(1500);
  await expect(thread(bharat.page, 'Launch crew').getByText('after B left')).toHaveCount(0);
  await bharat.page.reload();
  await expect(bharat.page.getByText('You’re no longer a member of this group')).toBeVisible(SLOW);
  await expect(thread(bharat.page, 'Launch crew').getByText('after B left')).toHaveCount(0);
  await expect(thread(bharat.page, 'Launch crew').getByText('hi from C')).toBeVisible(SLOW);

  // D joins with the link, and does not see older messages.
  await info(asha.page);
  const invite = asha.page.getByRole('region', { name: 'Invite link' });
  await invite.getByRole('button', { name: 'Create invite link' }).click();
  await expect(invite.getByTestId('invite-link')).toBeVisible(SLOW);
  const link = (await invite.getByTestId('invite-link').textContent()) ?? '';
  await closeInfo(asha.page);
  await dinesh.page.goto(new URL(link).pathname);
  await expect(dinesh.page.getByText('Launch crew')).toBeVisible(SLOW);
  await dinesh.page.getByRole('button', { name: 'Join' }).click();
  await expect(dinesh.page.getByRole('heading', { name: 'Launch crew' })).toBeAttached(SLOW);
  await expect(
    thread(dinesh.page, 'Launch crew').getByText('You joined using the invite link'),
  ).toBeVisible(SLOW);
  await send(asha.page, 'welcome D');
  await expectBubbles(dinesh.page, 'Launch crew', ['welcome D']);
  await expect(thread(dinesh.page, 'Launch crew').getByText('hello everyone')).toHaveCount(0);
  await expect(
    thread(asha.page, 'Launch crew').getByText('Dinesh joined using the invite link'),
  ).toBeVisible(SLOW);

  // Announcement mode blocks D from sending, and B stays out.
  await info(asha.page);
  const settings = asha.page.getByRole('region', { name: 'Group settings' });
  await settings.getByRole('combobox', { name: 'Send messages' }).selectOption('admins');
  await expect(dinesh.page.getByText('Only admins can send messages').first()).toBeVisible(SLOW);
  await expect(dinesh.page.getByRole('textbox', { name: 'Write a message' })).toHaveCount(0);
  await expect(bharat.page.getByRole('textbox', { name: 'Write a message' })).toHaveCount(0);
  await send(chitra.page, 'admins only now');
  await expectBubbles(dinesh.page, 'Launch crew', ['welcome D', 'admins only now']);

  // The old link stops working once reset.
  await invite.getByRole('button', { name: 'Reset' }).click();
  await expect(invite.getByTestId('invite-link')).not.toHaveText(link, SLOW);
  await bharat.page.goto(new URL(link).pathname);
  await expect(bharat.page.getByRole('alert')).toContainText('no longer valid', SLOW);
});

test('ticks in a group wait for everyone, and message info says who', async ({ browser }) => {
  const asha = await newPerson(browser, 'Asha');
  const bharat = await newPerson(browser, 'Bharat');
  const chitra = await newPerson(browser, 'Chitra');
  await createGroup(asha.page, 'Ticks', [bharat, chitra]);
  await openGroupFromList(bharat.page, 'Ticks');

  await send(asha.page, 'are you there');
  await expectBubbles(bharat.page, 'Ticks', ['are you there']);
  const mine = thread(asha.page, 'Ticks');
  // B has read it, and C has not even opened the app's chat: not everyone has it read yet.
  await asha.page.waitForTimeout(1000);
  await expect(mine.getByRole('img', { name: 'Read', exact: true })).toHaveCount(0);

  await openGroupFromList(chitra.page, 'Ticks');
  await expectBubbles(chitra.page, 'Ticks', ['are you there']);
  await expect(mine.getByRole('img', { name: 'Read', exact: true })).toBeVisible(SLOW);

  await mine.locator('li').last().hover();
  await mine.getByRole('button', { name: 'Message info' }).last().click();
  const dialog = asha.page.getByRole('dialog', { name: 'Message info' });
  await expect(dialog.getByText('Read by')).toBeVisible(SLOW);
  await expect(dialog.getByText('Bharat')).toBeVisible();
  await expect(dialog.getByText('Chitra')).toBeVisible();
});
