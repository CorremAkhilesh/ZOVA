import { expect, test } from '@playwright/test';
import { expectSent, newPerson, openChatWith, send, thread } from './chat-helpers';
import { SLOW } from './helpers';

// While scrolling, the day ("Today") floats at the top of the messages. On a phone it can sit right
// over something tappable, such as a long message's "Read more": a finger must still reach it.

test.describe.configure({ timeout: 180_000 });

test('on a 360 px phone, "Read more" under the floating day opens with a real tap', async ({
  browser,
  isMobile,
}) => {
  test.skip(!isMobile, 'Touch on a phone screen');
  const viewport = { width: 360, height: 740 };
  const asha = await newPerson(browser, 'Asha', { viewport, hasTouch: true, isMobile: true });
  const bharat = await newPerson(browser, 'Bharat');
  const page = asha.page;
  await openChatWith(page, bharat);
  const long = `The plan: ${'every step of the week, one by one. '.repeat(35)}`;
  await send(page, long);
  // Enough below it that "Read more" can be scrolled up to the top of the screen.
  await send(page, `And then: ${'notes for the next week, all of them. '.repeat(35)}`);
  for (let i = 1; i <= 12; i++) await send(page, `short ${i}`);
  await expectSent(page, bharat.name, 'short 12');

  const list = thread(page, bharat.name);
  const readMore = list.getByRole('button', { name: 'Read more' }).first();
  const chip = page.getByTestId('floating-day');
  let spot = { x: 0, y: 0 };
  // Scroll up (as a reader would) until "Read more" sits right under the floating day.
  await expect(async () => {
    await readMore.evaluate(async (button) => {
      let box: Element | null = button.parentElement;
      while (box && box.scrollHeight <= box.clientHeight) box = box.parentElement;
      const scroller = box as HTMLElement;
      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      // The day floats 8 px below the top of the list; it shows when the reader scrolls up.
      const target =
        scroller.scrollTop -
        (scroller.getBoundingClientRect().top + 12 - button.getBoundingClientRect().top);
      scroller.scrollTop = target + 150;
      await frame();
      await frame();
      scroller.scrollTop = target;
      await frame();
    });
    await expect(chip).toBeVisible({ timeout: 500 });
    const [under, over] = [await readMore.boundingBox(), await chip.boundingBox()];
    if (!under || !over) throw new Error('not on screen');
    // The day really covers part of the link.
    const left = Math.max(under.x, over.x);
    const right = Math.min(under.x + under.width, over.x + over.width);
    const top = Math.max(under.y, over.y);
    const bottom = Math.min(under.y + under.height, over.y + over.height);
    expect(right - left > 4 && bottom - top > 4).toBe(true);
    spot = { x: (left + right) / 2, y: (top + bottom) / 2 };
  }).toPass(SLOW);

  // A finger landing where the day covers the link reaches the link, not the day...
  const hit = await page.evaluate(
    ({ x, y }) => document.elementFromPoint(x, y)?.textContent ?? '',
    spot,
  );
  expect(hit).toBe('Read more');
  // Still over it when the finger lands (it fades 1.5 s after scrolling stops).
  await expect(chip).toBeVisible({ timeout: 0 });
  await page.touchscreen.tap(spot.x, spot.y);
  // ...and the day steps aside at once, so nothing hides what is being tapped.
  await expect(chip).toBeHidden({ timeout: 300 });
  await expect(list.getByText(long.trim())).toBeVisible(SLOW);
  await asha.context.close();
  await bharat.context.close();
});
