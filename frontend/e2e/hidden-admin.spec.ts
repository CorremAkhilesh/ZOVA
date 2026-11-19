import { expect, test } from '@playwright/test';
import { ADMIN, signInAdmin } from './admin-helpers';
import { expectSent, newPerson, openChatWith, openFromList, send, thread } from './chat-helpers';
import { SLOW } from './helpers';

// The ADMIN_EMAILS account is invisible to normal users: New chat neither suggests nor finds it.
// The admin can still message anyone, and the person answers in that chat.

test.describe.configure({ timeout: 300_000 });
test.use({ actionTimeout: 30_000 });

test('a user never finds the admin, but gets the admin’s message and replies', async ({
  browser,
}) => {
  const context = await browser.newContext();
  const admin = await context.newPage();
  await signInAdmin(admin);
  const me = (await (await admin.request.get('/v1/auth/me')).json()).user as {
    displayName: string;
    username: string;
  };
  const riya = await newPerson(browser, 'Riya');

  // New chat: not among the suggestions, and "No one found" by @username, name or email.
  await riya.page.getByRole('button', { name: 'New chat' }).click();
  const picker = riya.page.getByRole('dialog', { name: 'New chat' });
  await expect(picker.getByRole('combobox')).toBeVisible(SLOW);
  // Give the suggestions time to arrive: the admin must not be among them.
  await riya.page
    .waitForResponse((r) => r.url().includes('/v1/users/search'), SLOW)
    .catch(() => {});
  await expect(picker.getByRole('option', { name: new RegExp(me.username) })).toHaveCount(0);
  for (const query of [me.username, me.displayName, ADMIN]) {
    await picker.getByRole('combobox').fill(query);
    await expect(picker.getByText('No one found.')).toBeVisible(SLOW);
  }
  await riya.page.keyboard.press('Escape');

  // The admin finds Riya and writes; Riya gets it and answers in the same chat.
  await openChatWith(admin, riya);
  await send(admin, 'Welcome aboard, Riya');
  await expectSent(admin, riya.name, 'Welcome aboard, Riya');
  await openFromList(riya.page, me.displayName);
  await expect(thread(riya.page, me.displayName).getByText('Welcome aboard, Riya')).toBeVisible(
    SLOW,
  );
  await send(riya.page, 'Thank you!');
  await expectSent(riya.page, me.displayName, 'Thank you!');
  await expect(thread(admin, riya.name).getByText('Thank you!')).toBeVisible(SLOW);

  await context.close();
  await riya.context.close();
});
