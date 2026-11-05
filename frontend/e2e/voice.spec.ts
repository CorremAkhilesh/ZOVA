import { expect, type Page, test } from '@playwright/test';
import {
  expectBubbles,
  newPerson,
  openChatWith,
  openFromList,
  type Person,
  send,
} from './chat-helpers';
import { SLOW } from './helpers';

test.describe.configure({ timeout: 240_000 });

// The microphone is a fake one, which only Chromium can be given. Touch gestures are covered in
// component tests: a recording here is started by a click, as on a desktop.
test.beforeEach(({ browserName, isMobile }) => {
  test.skip(browserName !== 'chromium', 'A fake microphone needs Chromium launch flags');
  test.skip(isMobile, 'Press-and-hold is covered by component tests');
});

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

async function startRecording(page: Page) {
  await page.getByRole('button', { name: 'Record a voice note' }).click();
  // The explanation comes first, the first time.
  const allow = page.getByRole('button', { name: 'Continue' });
  await expect(allow.or(page.getByRole('timer'))).toBeVisible(SLOW);
  if (await allow.isVisible()) await allow.click();
  await expect(page.getByRole('timer')).toBeVisible(SLOW);
}

async function recordFor(page: Page, seconds: number) {
  await startRecording(page);
  await expect(page.getByRole('timer')).toHaveText(`0:0${seconds}`, { timeout: 30_000 });
}

const thread = (page: Page, name: string) => page.getByRole('list', { name, exact: true });
const playButton = (page: Page, name: string) =>
  thread(page, name).getByRole('button', { name: 'Play voice message' });

test('a voice note reaches the other person, who plays it, and the sender sees that', async ({
  browser,
}) => {
  const [asha, bharat] = await chatting(browser);
  await recordFor(asha.page, 3);
  await asha.page.getByRole('button', { name: 'Send voice message' }).click();

  // The receiver: a bubble with its shape and length, an unplayed dot, and the chat list says so.
  await expect(playButton(bharat.page, 'Asha')).toBeVisible({ timeout: 60_000 });
  const theirs = thread(bharat.page, 'Asha');
  await expect(theirs.getByRole('slider', { name: 'Position' })).toBeVisible();
  await expect(theirs.getByRole('slider', { name: 'Position' }).locator('span')).toHaveCount(64);
  await expect(theirs.getByText(/^0:0[3-4]$/)).toBeVisible();
  await expect(theirs.getByRole('img', { name: 'Not played yet' })).toBeVisible();
  await expect(asha.page.getByRole('link', { name: /Bharat/ })).toContainText(
    /🎤 Voice message \(0:0[3-4]\)/,
    SLOW,
  );

  // The sender: uploaded, and not played yet.
  const mine = thread(asha.page, 'Bharat');
  await expect(mine.getByRole('img', { name: 'Not played yet' })).toBeVisible(SLOW);

  await playButton(bharat.page, 'Asha').click();
  await expect(bharat.page.getByRole('region', { name: 'Now playing' })).toBeVisible(SLOW);

  // Past half way: the sender's mic is colored, and the receiver's dot has gone.
  await expect(mine.getByRole('img', { name: 'Played', exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(theirs.getByRole('img', { name: 'Not played yet' })).toHaveCount(0, SLOW);

  // It ends, and the player goes away by itself.
  await expect(bharat.page.getByRole('region', { name: 'Now playing' })).toBeHidden({
    timeout: 30_000,
  });
});

test('seeking moves through the note, and the speed is remembered', async ({ browser }) => {
  const [asha, bharat] = await chatting(browser);
  await recordFor(asha.page, 4);
  await asha.page.getByRole('button', { name: 'Send voice message' }).click();
  await expect(playButton(bharat.page, 'Asha')).toBeVisible({ timeout: 60_000 });

  await playButton(bharat.page, 'Asha').click();
  const region = bharat.page.getByRole('region', { name: 'Now playing' });
  await expect(region).toBeVisible(SLOW);
  await region.getByRole('button', { name: 'Pause' }).click();

  // A recording in WebM has no index and does not say how long it is, so a browser may refuse to go
  // there. Playing on from the new place is what proves it did: a refused seek would jump back, and
  // the position comes from the audio element itself.
  const slider = thread(bharat.page, 'Asha').getByRole('slider', { name: 'Position' });
  const box = await slider.boundingBox();
  if (!box) throw new Error('The waveform has no size');
  await bharat.page.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
  await region.getByRole('button', { name: 'Play voice message' }).click();
  await bharat.page.waitForTimeout(400);
  const heard = await slider.getAttribute('aria-valuenow').catch(() => null);
  // Either still playing from there, or already finished: the note is only about a second from the end.
  if (heard !== null && (await region.isVisible())) expect(Number(heard)).toBeGreaterThanOrEqual(2);
  await expect(region).toBeHidden({ timeout: 8000 });

  await playButton(bharat.page, 'Asha').click();
  await expect(region).toBeVisible(SLOW);
  await region.getByRole('button', { name: /Speed 1x/ }).click();
  await expect(region.getByRole('button', { name: /Speed 1.5x/ })).toBeVisible();
  await bharat.page.reload();
  await expect(playButton(bharat.page, 'Asha')).toBeVisible(SLOW);
  const saved = await bharat.page.evaluate(() => localStorage.getItem('zuvo.voice-speed'));
  expect(saved).toBe('1.5');
});

test('cancelling discards the recording, and a very short one is not sent', async ({ browser }) => {
  const [asha, bharat] = await chatting(browser);

  await recordFor(asha.page, 2);
  await asha.page.getByRole('button', { name: 'Delete recording' }).click();
  await expect(asha.page.getByRole('timer')).toHaveCount(0);

  // Straight back out again: under a second.
  await startRecording(asha.page);
  await asha.page.getByRole('button', { name: 'Send voice message' }).click();
  await expect(asha.page.getByText(/Too short to send/)).toBeVisible(SLOW);

  await send(asha.page, 'nothing else');
  await expectBubbles(bharat.page, 'Asha', ['hello', 'nothing else']);
  await expect(thread(asha.page, 'Bharat').getByRole('slider')).toHaveCount(0);
});

test('a note recorded offline is sent after reconnecting, once', async ({ browser }) => {
  const [asha, bharat] = await chatting(browser);

  await recordFor(asha.page, 2);
  await asha.context.setOffline(true);
  await asha.page.getByRole('button', { name: 'Send voice message' }).click();
  const mine = thread(asha.page, 'Bharat');
  await expect(mine.getByRole('slider', { name: 'Position' })).toBeVisible(SLOW);
  await asha.page.waitForTimeout(1500);
  await expect(playButton(bharat.page, 'Asha')).toHaveCount(0);

  await asha.context.setOffline(false);
  await expect(playButton(bharat.page, 'Asha')).toBeVisible({ timeout: 60_000 });
  await expect(mine.getByRole('button', { name: /Cancel upload/ })).toHaveCount(0, SLOW);
  await asha.page.waitForTimeout(1500);
  await expect(playButton(bharat.page, 'Asha')).toHaveCount(1);
});
