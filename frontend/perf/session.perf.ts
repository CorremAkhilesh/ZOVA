import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { expectBubbles, newPerson, openChatWith, openFromList, send } from '../e2e/chat-helpers';
import { SLOW } from '../e2e/helpers';
import { installProbes, openCdp, type Snapshot, snapshot } from './probes';

/**
 * A long chatting session, compressed: each cycle sends and receives 20 messages, opens and closes
 * chats, Settings, the photo viewer and a voice note. Memory and listener counts are compared after
 * a forced GC, between a warmed-up baseline and the end. Growth per cycle is what leaks.
 */
const CYCLES = Number(process.env.PERF_CYCLES ?? 8);
const PER_CYCLE = 10;
const LABEL = process.env.PERF_LABEL ?? 'latest';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAIAAAACUFjqAAAAEklEQVR4nGNk+M+ABIwMDAwAFAoBAX1Nz8QAAAAASUVORK5CYII=',
  'base64',
);

const thread = (page: Page, name: string) => page.getByRole('list', { name, exact: true });

async function recordVoiceNote(page: Page) {
  await page.getByRole('button', { name: 'Record a voice note' }).click();
  const allow = page.getByRole('button', { name: 'Continue' });
  await expect(allow.or(page.getByRole('timer'))).toBeVisible(SLOW);
  if (await allow.isVisible()) await allow.click();
  await expect(page.getByRole('timer')).toHaveText('0:02', { timeout: 30_000 });
  await page.getByRole('button', { name: 'Send voice message' }).click();
}

async function sendPhoto(page: Page) {
  await page.getByRole('button', { name: 'Attach a file' }).click();
  await page
    .getByTestId('pick-media')
    .setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PNG });
  const sheet = page.getByRole('dialog', { name: 'Send 1 file' });
  await sheet.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(sheet).toBeHidden(SLOW);
}

test('memory and listeners stay flat over a long chatting session', async ({ browser }) => {
  // A busy machine sends slowly: allow for it.
  test.setTimeout(45 * 60_000);
  const asha = await newPerson(browser, 'Asha');
  const bharat = await newPerson(browser, 'Bharat');
  await installProbes(asha.context);
  await asha.page.reload();
  await openChatWith(asha.page, bharat);
  await send(asha.page, 'hello');
  await expect(bharat.page.getByRole('link', { name: /Asha/ })).toBeVisible(SLOW);
  await openFromList(bharat.page, 'Asha');
  await expectBubbles(bharat.page, 'Asha', ['hello']);

  // Media to come back to in every cycle: a photo and a voice note, from Bharat.
  await sendPhoto(bharat.page);
  await recordVoiceNote(bharat.page);
  const ours = thread(asha.page, 'Bharat');
  await expect(ours.getByRole('button', { name: /Open photo/ })).toBeVisible(SLOW);
  await expect(ours.getByRole('button', { name: 'Play voice message' })).toBeVisible({
    timeout: 60_000,
  });

  let sent = 0;
  async function cycle(page: Page) {
    for (let n = 0; n < PER_CYCLE; n++) await send(page, `from Asha ${++sent}`);
    for (let n = 0; n < PER_CYCLE; n++) await send(bharat.page, `from Bharat ${sent}-${n}`);
    await expect(
      thread(page, 'Bharat').getByText(`from Bharat ${sent}-${PER_CYCLE - 1}`),
    ).toBeVisible(SLOW);
    // Open and close other screens.
    await page.getByRole('link', { name: 'Settings', exact: true }).first().click();
    await expect(page.getByRole('heading', { name: 'Settings' }).first()).toBeVisible(SLOW);
    await page.getByRole('link', { name: 'Chats', exact: true }).first().click();
    await openFromList(page, 'Saved Messages');
    await openFromList(page, 'Bharat');
    const messages = thread(page, 'Bharat');
    // Back to the media at the top of the chat (older rows are measured as they appear, so the
    // top moves: keep going up until the photo is there).
    const photo = messages.getByRole('button', { name: /Open photo/ }).first();
    await expect
      .poll(
        async () => {
          await page.locator('[aria-label="Messages"]').evaluate((element) => {
            element.scrollTop = 0;
          });
          return photo.isVisible();
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    // The viewer.
    await photo.click();
    await expect(page.getByRole('dialog')).toBeVisible(SLOW);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden(SLOW);
    // A voice note: play for a moment, then stop.
    await messages.getByRole('button', { name: 'Play voice message' }).first().click();
    const nowPlaying = page.getByRole('region', { name: 'Now playing' });
    await expect(nowPlaying).toBeVisible(SLOW);
    await page.waitForTimeout(700);
    await nowPlaying.getByRole('button', { name: 'Close player' }).click();
    await expect(nowPlaying).toBeHidden(SLOW);
  }

  const cdp = await openCdp(asha.page);
  await openFromList(asha.page, 'Bharat');
  // Warm-up: every chunk loaded, every cache filled once.
  await cycle(asha.page);
  await cycle(asha.page);
  const before = await snapshot(asha.page, cdp);
  const listenersBefore = (await asha.page.evaluate(() => window.__perfListeners?.())) ?? {};
  const started = Date.now();
  for (let n = 0; n < CYCLES; n++) await cycle(asha.page);
  const sessionSeconds = Math.round((Date.now() - started) / 1000);
  const after = await snapshot(asha.page, cdp);
  const listenersAfter = (await asha.page.evaluate(() => window.__perfListeners?.())) ?? {};
  // Listeners that grew over the session: added and never removed.
  const growingListeners = Object.fromEntries(
    Object.entries(listenersAfter)
      .map(([key, count]) => [key, count - (listenersBefore[key] ?? 0)] as const)
      .filter(([, grew]) => grew > 0),
  );

  const growth = Object.fromEntries(
    (Object.keys(after) as (keyof Snapshot)[]).map((key) => [
      key,
      Math.round(((after[key] - before[key]) / CYCLES) * 100) / 100,
    ]),
  );
  const intervals = await asha.page.evaluate(() => window.__perfIntervals?.());
  const numbers = {
    label: LABEL,
    at: new Date().toISOString(),
    cycles: CYCLES,
    messagesSentAndReceived: CYCLES * PER_CYCLE * 2,
    sessionSeconds,
    before,
    after,
    growthPerCycle: growth,
    liveIntervalsBySource: intervals,
    growingListeners,
  };
  // biome-ignore lint/suspicious/noConsole: these numbers are what this benchmark is for
  console.log(`SESSION ${JSON.stringify(numbers, null, 2)}`);
  mkdirSync('perf/reports', { recursive: true });
  writeFileSync(`perf/reports/session-${LABEL}.json`, JSON.stringify(numbers, null, 2));

  await asha.context.close();
  await bharat.context.close();
});
