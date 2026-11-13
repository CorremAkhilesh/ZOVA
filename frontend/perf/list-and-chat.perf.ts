import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { localDatabases, newPerson } from '../e2e/chat-helpers';
import { SLOW } from '../e2e/helpers';
import { median, percentile } from './probes';
import { seedDatabase } from './seed';

const CHATS = 500;
const MESSAGES = 10_000;
const RUNS = 5;
const LONG_CHAT = '0'.repeat(23).concat('1');
const LABEL = process.env.PERF_LABEL ?? 'latest';

const chatsLink = (page: Page) => page.getByRole('link', { name: 'Chats', exact: true }).first();
const settingsLink = (page: Page) =>
  page.getByRole('link', { name: 'Settings', exact: true }).first();

/** From the click on "Chats" until the first screen of rows is painted. */
function timeChatList(page: Page) {
  return page.evaluate(async () => {
    let blocked = 0;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) blocked += Math.max(0, entry.duration - 50);
    });
    observer.observe({ type: 'longtask', buffered: false });
    const started = performance.now();
    (document.querySelector('a[href="/chats"]') as HTMLElement).click();
    const shown = () => {
      const text = document.querySelector('[data-testid="chat-rows"]')?.textContent ?? '';
      return text.includes('Colleague 1') && text.includes('Colleague 8');
    };
    while (!shown()) {
      if (performance.now() - started > 60_000) throw new Error('The chat list never showed');
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    // The frame that shows them.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const ms = performance.now() - started;
    await new Promise((resolve) => setTimeout(resolve, 100));
    observer.disconnect();
    return { ms, blockedMs: blocked, rowsInPage: document.querySelectorAll('.chat-row').length };
  });
}

/** Scrolls a list by `step` px per frame until its end (or `limitMs`), timing every frame. */
function scrollFrames(page: Page, selector: string, step: number, limitMs: number) {
  return page.evaluate(
    async ({ selector, step, limitMs }) => {
      const scroller = document.querySelector(selector) as HTMLElement;
      const frames: number[] = [];
      let peakRows = 0;
      let previous = performance.now();
      const end = previous + limitMs;
      let stalled = 0;
      while (performance.now() < end) {
        const before = scroller.scrollTop;
        scroller.scrollTop += step;
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const now = performance.now();
        frames.push(now - previous);
        previous = now;
        peakRows = Math.max(peakRows, scroller.querySelectorAll('li').length);
        // At the end (older messages may still be arriving above: give them a few frames).
        stalled = scroller.scrollTop === before ? stalled + 1 : 0;
        if (stalled >= 10) break;
      }
      return { frames, peakRows };
    },
    { selector, step, limitMs },
  );
}

const summary = ({ frames, peakRows }: { frames: number[]; peakRows: number }) => ({
  frames: frames.length,
  fps: Math.round(frames.length / (frames.reduce((a, b) => a + b, 0) / 1000)),
  frameP50Ms: Math.round(percentile(frames, 0.5)),
  frameP95Ms: Math.round(percentile(frames, 0.95)),
  framesOver50Ms: frames.filter((frame) => frame > 50).length,
  worstFrameMs: Math.round(Math.max(...frames)),
  rowsInPageAtMost: peakRows,
});

test('500 chats and a 10,000-message chat', async ({ browser }) => {
  const { page, context } = await newPerson(browser, 'Perf');
  // The first sync must finish first: its reset would replace what is seeded here.
  await expect(page.getByRole('link', { name: /Saved Messages/ })).toBeVisible(SLOW);
  const [name] = await localDatabases(page);
  await page.evaluate(seedDatabase, {
    name: name ?? '',
    chats: CHATS,
    messages: MESSAGES,
    chatId: LONG_CHAT,
  });
  await page.reload();
  await expect(page.getByRole('link', { name: /Colleague 1\b/ })).toBeVisible({ timeout: 60_000 });

  const list: Awaited<ReturnType<typeof timeChatList>>[] = [];
  for (let run = 0; run < RUNS + 1; run++) {
    await settingsLink(page).click();
    await expect(page.locator('.chat-row')).toHaveCount(0);
    const result = await timeChatList(page);
    // The first run warms the route chunk and Dexie; it is not counted.
    if (run > 0) list.push(result);
  }
  const listScroller = 'section[aria-labelledby="chat-list-title"] [data-slot="scroll-area"]';
  const listScroll = summary(await scrollFrames(page, listScroller, 120, 20_000));
  await expect(page.getByText('Colleague 500')).toBeAttached();

  // Open the long chat: from the click until its newest message is on screen.
  const openTimes: number[] = [];
  for (let run = 0; run < RUNS; run++) {
    await settingsLink(page).click();
    await chatsLink(page).click();
    await expect(page.getByRole('link', { name: /Colleague 1\b/ })).toBeVisible(SLOW);
    openTimes.push(
      await page.evaluate(
        async ({ last, href }) => {
          const link = document.querySelector<HTMLElement>(`a[href="${href}"]`);
          if (!link) throw new Error(`No link to ${href}`);
          const started = performance.now();
          link.click();
          const found = () =>
            [...document.querySelectorAll('[aria-label="Messages"] p')].some((element) =>
              element.textContent?.startsWith(last),
            );
          while (!found()) {
            if (performance.now() - started > 60_000) throw new Error('The chat never showed');
            await new Promise((resolve) => requestAnimationFrame(resolve));
          }
          await new Promise((resolve) => requestAnimationFrame(resolve));
          return performance.now() - started;
        },
        { last: `Message number ${MESSAGES}`, href: `/chats/${LONG_CHAT}` },
      ),
    );
  }

  // Up through the chat: reading pace for 8 s, then a fast fling through most of it.
  const messages = '[aria-label="Messages"]';
  const reading = summary(await scrollFrames(page, messages, -240, 8000));
  const fling = summary(await scrollFrames(page, messages, -2000, 30_000));

  const numbers = {
    label: LABEL,
    at: new Date().toISOString(),
    chats: CHATS,
    messages: MESSAGES,
    chatList: {
      runs: list.map((run) => Math.round(run.ms)),
      medianMs: Math.round(median(list.map((run) => run.ms))),
      medianBlockedMs: Math.round(median(list.map((run) => run.blockedMs))),
      rowsInPage: list[0]?.rowsInPage,
      scroll: listScroll,
    },
    openLongChat: {
      runs: openTimes.map(Math.round),
      medianMs: Math.round(median(openTimes)),
    },
    messageScroll: { reading, fling },
  };
  // biome-ignore lint/suspicious/noConsole: these numbers are what this benchmark is for
  console.log(`PERFORMANCE ${JSON.stringify(numbers, null, 2)}`);
  mkdirSync('perf/reports', { recursive: true });
  writeFileSync(`perf/reports/list-and-chat-${LABEL}.json`, JSON.stringify(numbers, null, 2));
  await context.close();
});
