import { expect, test } from '@playwright/test';
import { expectSent, newPerson, openChatWith, openFromList, send, thread } from './chat-helpers';
import { SLOW, waitForActiveServiceWorker } from './helpers';

// "Share to Zuvo": another app posts files and text to /share-target (the manifest's share_target).
// Here the same post comes from a form, so it goes through the real service worker: two files and a
// line of text, sent to two chats, which both receive them.

test.describe.configure({ timeout: 300_000 });
test.use({ actionTimeout: 30_000 });

test('two files and text shared from another app reach two chats', async ({
  browser,
  browserName,
}) => {
  test.skip(
    browserName === 'webkit',
    'Playwright’s WebKit does not run service workers for share targets; unit tests cover the worker.',
  );
  const asha = await newPerson(browser, 'Asha');
  const bharat = await newPerson(browser, 'Bharat');
  const chitra = await newPerson(browser, 'Chitra');
  for (const other of [bharat, chitra]) {
    await asha.page.goto('/chats');
    await openChatWith(asha.page, other);
    await send(asha.page, `hello ${other.name}`);
    await expectSent(asha.page, other.name, `hello ${other.name}`);
  }
  await asha.page.goto('/chats');
  await waitForActiveServiceWorker(asha.page);

  // What Android or Windows posts when someone picks the app in their share list.
  await asha.page.evaluate(() => {
    const form = document.createElement('form');
    form.id = 'share-target-test';
    form.method = 'post';
    form.enctype = 'multipart/form-data';
    form.action = '/share-target';
    form.innerHTML = '<input type="file" name="files" multiple><input name="text">';
    document.body.append(form);
  });
  await asha.page.locator('#share-target-test input[type=file]').setInputFiles([
    { name: 'budget.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Remember the receipts.') },
  ]);
  await asha.page.locator('#share-target-test input[name=text]').fill('From the Files app');
  await asha.page.evaluate(() =>
    (document.getElementById('share-target-test') as HTMLFormElement).submit(),
  );

  await expect(asha.page).toHaveURL(/\/share\?id=/, SLOW);
  const preview = asha.page.getByRole('region', { name: 'What you are sharing' });
  await expect(preview.getByText('budget.pdf')).toBeVisible(SLOW);
  await expect(preview.getByText('notes.txt')).toBeVisible();
  // Tap the chat rows (the checkbox inside is for screen readers).
  const picker = asha.page.getByRole('region', { name: 'Choose chats' });
  for (const name of ['Bharat', 'Chitra']) {
    await picker.locator('label').filter({ hasText: name }).click();
    await expect(picker.getByRole('checkbox', { name: new RegExp(name) })).toBeChecked();
  }
  await expect(asha.page.getByRole('textbox', { name: 'Caption' })).toHaveValue(
    'From the Files app',
  );
  await asha.page.getByRole('button', { name: 'Send to 2 chats' }).click();
  await expect(asha.page).toHaveURL(/\/chats$/, SLOW);

  for (const other of [bharat, chitra]) {
    await other.page.goto('/chats');
    await openFromList(other.page, 'Asha');
    const messages = thread(other.page, 'Asha');
    await expect(messages.getByText('budget.pdf')).toBeVisible(SLOW);
    await expect(messages.getByText('notes.txt')).toBeVisible(SLOW);
    await expect(messages.getByText('From the Files app')).toBeVisible(SLOW);
  }

  await asha.context.close();
  await bharat.context.close();
  await chitra.context.close();
});
