import { expect, type Page, test } from '@playwright/test';
import { createGroup, expectSent, newPerson, openFromList, send, thread } from './chat-helpers';
import { PHOTO_96 } from './fixtures';
import { SLOW } from './helpers';

// The conversation reads like a messenger should: one sender's run sits close together, a very long
// message folds behind "Read more", repeated system lines collapse into one with a count, long
// links wrap inside the bubble, and the info pane lists members with their about and role. On a
// desktop and on a 375 px phone.

test.describe.configure({ timeout: 300_000 });
test.use({ actionTimeout: 30_000 });

const LONG = Array.from({ length: 25 }, (_, i) => `Note ${i + 1}: keep receipts for travel.`).join(
  '\n',
);
const LINK = `See https://docs.corremadvisory.com/${'very-long-path-segment/'.repeat(8)}end`;

async function setPhoto(page: Page, chatId: string) {
  const response = await page.request.post(`/v1/chats/${chatId}/group/photo`, {
    multipart: { file: { name: 'team.png', mimeType: 'image/png', buffer: PHOTO_96 } },
  });
  expect(response.ok(), await response.text()).toBe(true);
}

for (const width of [1366, 375] as const) {
  test(`a group conversation at ${width} px`, async ({ browser }) => {
    const asha = await newPerson(browser, 'Asha');
    const ravi = await newPerson(browser, 'Ravi');
    await asha.page.setViewportSize({ width, height: width === 375 ? 812 : 768 });
    await asha.page.goto('/chats');
    const name = `Design ${width}`;
    await createGroup(asha.page, name, [ravi]);
    const chatId = new URL(asha.page.url()).pathname.split('/').at(-1) ?? '';
    for (let i = 0; i < 3; i++) await setPhoto(asha.page, chatId);
    await ravi.page.request.patch('/v1/me/profile', { data: { about: 'Finance · Mumbai' } });

    await openFromList(ravi.page, name);
    for (const text of ['one', 'two', LINK, LONG]) await send(ravi.page, text);
    await expectSent(ravi.page, name, 'one');

    const list = thread(asha.page, name);
    // Three photo changes: one line with a count.
    await expect(list.getByText('You changed the group photo (3)')).toBeVisible(SLOW);
    // The long message folds; "Read more" opens it.
    const readMore = list.getByRole('button', { name: 'Read more' });
    await expect(readMore).toBeVisible(SLOW);
    await expect(list.getByText(/Note 25:/)).toHaveCount(0);
    await readMore.click();
    await expect(list.getByText(/Note 25:/)).toBeVisible();
    // Ravi's run: tight gaps inside it.
    const gap = await asha.page.evaluate(() => {
      const rows = [...document.querySelectorAll<HTMLElement>('[data-seq]')];
      const one = rows.find((row) => row.textContent?.includes('one'));
      const two = rows.find((row) => row.textContent?.includes('two'));
      if (!one || !two) return null;
      return two.getBoundingClientRect().top - one.getBoundingClientRect().bottom;
    });
    expect(gap).not.toBeNull();
    expect(gap as number).toBeLessThanOrEqual(4);
    // Nothing scrolls sideways: the long link wraps inside its bubble.
    const sideways = await asha.page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(sideways).toBe(false);

    // Info: Ravi with his about; me first as the owner.
    // A toast may sit over the header on a phone: open info the way a keyboard user would.
    await asha.page.locator('[data-info-toggle]').press('Enter');
    const members = asha.page.getByRole('list', { name: 'Members' });
    await expect(members.getByText('Finance · Mumbai')).toBeVisible(SLOW);
    await expect(members.getByRole('listitem').first()).toContainText('You');
    await expect(members.getByRole('listitem').first()).toContainText('Owner');

    await asha.context.close();
    await ravi.context.close();
  });
}
