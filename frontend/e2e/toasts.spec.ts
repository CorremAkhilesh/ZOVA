import { expect, test } from '@playwright/test';
import { createGroup, newPerson, openChatWith, send } from './chat-helpers';
import { SLOW } from './helpers';

// A toast never covers a header: on a phone and on a desktop, while a toast is up, the chat
// header's info button still takes a real tap, and the toast can be closed at once.

test.describe.configure({ timeout: 240_000 });
test.use({ actionTimeout: 30_000 });

for (const viewport of [
  { name: 'phone', width: 375, height: 812 },
  { name: 'desktop', width: 1366, height: 768 },
] as const) {
  test(`with a toast up, the header still works (${viewport.name})`, async ({ browser }) => {
    const asha = await newPerson(browser, 'Asha');
    const ravi = await newPerson(browser, 'Ravi');
    await asha.page.setViewportSize(viewport);
    await asha.page.goto('/chats');
    await createGroup(asha.page, `Toasts ${viewport.name}`, [ravi]);

    // A message in another chat while Asha reads the group: an in-app toast.
    await openChatWith(ravi.page, asha);
    await send(ravi.page, 'Quick question about the budget');
    const toast = asha.page.locator('[data-sonner-toast]').first();
    await expect(toast).toBeVisible(SLOW);

    // It sits below the header, not over it.
    const header = await asha.page.locator('header').first().boundingBox();
    const box = await toast.boundingBox();
    expect(header && box).toBeTruthy();
    if (header && box) expect(box.y).toBeGreaterThanOrEqual(header.y + header.height);
    // On a desktop it sits over the chat list, never over the conversation's messages.
    if (viewport.name === 'desktop' && box) {
      const messages = await asha.page.getByLabel('Messages', { exact: true }).boundingBox();
      expect(messages).toBeTruthy();
      if (messages) expect(box.x + box.width).toBeLessThanOrEqual(messages.x + 1);
    }

    // A real tap on the header's info button works while the toast is up.
    await asha.page.locator('[data-info-toggle]').click();
    await expect(asha.page.getByRole('list', { name: 'Members' })).toBeVisible(SLOW);

    // A toast closes at once with its close button.
    await asha.page.keyboard.press('Escape');
    await send(ravi.page, 'And one more thing');
    const next = asha.page.locator('[data-sonner-toast]').filter({ hasText: 'one more thing' });
    await expect(next).toBeVisible(SLOW);
    await next.getByRole('button', { name: 'Dismiss' }).click();
    await expect(next).toHaveCount(0, SLOW);

    await asha.context.close();
    await ravi.context.close();
  });
}
