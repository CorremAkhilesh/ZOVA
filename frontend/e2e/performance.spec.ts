import { expect, test } from '@playwright/test';
import { localDatabases, newPerson } from './chat-helpers';
import { SLOW } from './helpers';

const CHATS = 200;
const MESSAGES = 10_000;
const LONG_CHAT = '0'.repeat(23).concat('1');

const percentile = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length * p)] ?? 0;

interface SeedOptions {
  name: string;
  chats: number;
  messages: number;
  chatId: string;
}

/** Writes straight to IndexedDB, so the numbers measure the app rather than the server. */
async function seedDatabase({ name, chats, messages, chatId }: SeedOptions) {
  const open = indexedDB.open(name);
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  const stores = db.transaction(['chats', 'messages'], 'readwrite');
  const now = Date.now();
  for (let n = 1; n <= chats; n++) {
    const at = new Date(now - n * 60_000).toISOString();
    stores.objectStore('chats').put({
      id: n === 1 ? chatId : n.toString(16).padStart(24, '0'),
      type: 'direct',
      seq: n === 1 ? messages : 1,
      otherUser: {
        id: n.toString(16).padStart(24, 'b'),
        displayName: `Colleague ${n}`,
        username: `colleague${n}`,
        about: null,
        avatar: null,
        deactivated: false,
      },
      lastMessage: {
        id: `last-${n}`,
        seq: n === 1 ? messages : 1,
        senderId: 'someone',
        type: 'text',
        preview: `The last thing said in chat number ${n}`,
        createdAt: at,
      },
      lastReadSeq: n === 1 ? messages : 1,
      unreadCount: 0,
      lastActivityAt: at,
      createdAt: at,
      sortAt: Date.parse(at),
    });
  }
  for (let seq = 1; seq <= messages; seq++) {
    const senderId = seq % 4 === 0 ? 'me' : 'someone';
    stores.objectStore('messages').put({
      key: `m${seq}`,
      id: `m${seq}`,
      chatId,
      seq,
      order: seq,
      clientMsgId: null,
      senderId,
      type: 'text',
      text: `Message number ${seq}${seq % 7 === 0 ? ', a longer one that wraps onto a second line in the bubble for a more honest layout test.' : ''}`,
      replyToId: null,
      editedAt: null,
      deletedForEveryoneAt: null,
      createdAt: new Date(now - (messages - seq) * 60_000).toISOString(),
      status: 'sent',
    });
  }
  await new Promise<void>((resolve, reject) => {
    stores.oncomplete = () => resolve();
    stores.onerror = () => reject(stores.error);
  });
  db.close();
}

/** Report-only limits in CI: runners vary. The numbers go in the log and the test's annotations. */
test('200 chats render quickly, and 10,000 messages scroll smoothly', async ({
  browser,
  browserName,
  isMobile,
}, testInfo) => {
  test.skip(
    browserName !== 'chromium' || isMobile,
    'One desktop browser is enough for the timings',
  );
  test.setTimeout(240_000);
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
  // The list is virtualized: only the visible rows exist, each knowing the full count.
  await expect(page.locator('.chat-row').first()).toHaveAttribute(
    'aria-setsize',
    String(CHATS + 1),
    { timeout: 30_000 },
  );

  // Chat list: leave for Settings and come back. Reads from Dexie and renders the visible rows.
  const listTimes: number[] = [];
  for (let run = 0; run < 7; run++) {
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page.locator('.chat-row')).toHaveCount(0);
    listTimes.push(
      await page.evaluate(async (count) => {
        const started = performance.now();
        (document.querySelector('a[href="/chats"]') as HTMLElement).click();
        const ready = () =>
          document.querySelector('.chat-row')?.getAttribute('aria-setsize') === String(count);
        while (!ready()) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
        }
        return performance.now() - started;
      }, CHATS + 1),
    );
  }

  // Open the long chat: from the click until its last message is on screen.
  const openMs = await page.evaluate(async (last) => {
    const started = performance.now();
    const link = [...document.querySelectorAll<HTMLElement>('a[href^="/chats/"]')].find((element) =>
      element.textContent?.includes('Colleague 1'),
    );
    link?.click();
    const found = () =>
      [...document.querySelectorAll('[aria-label="Messages"] p')].some((element) =>
        element.textContent?.startsWith(last),
      );
    while (!found()) await new Promise((resolve) => requestAnimationFrame(resolve));
    return performance.now() - started;
  }, `Message number ${MESSAGES}`);

  // Two scrolls towards the top, measuring every frame: reading pace, then a long fast fling that
  // goes back through most of the chat.
  const measureScroll = (pixelsPerFrame: number) =>
    page.evaluate(async (step) => {
      const scroller = document.querySelector('[aria-label="Messages"]') as HTMLElement;
      const frames: number[] = [];
      let peakRows = 0;
      let previous = performance.now();
      const started = previous;
      const end = previous + 30_000;
      // The bubble's own text is exactly this; "Message number 10" must not count.
      const first = () =>
        [...scroller.querySelectorAll('p')].some(
          (element) => element.childNodes[0]?.textContent === 'Message number 1',
        );
      let seconds = 0;
      // Up to 8 s at reading pace; the fling runs on until it reaches the first message.
      while (performance.now() < (step < 1000 ? started + 8000 : end)) {
        scroller.scrollTop -= step;
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const now = performance.now();
        frames.push(now - previous);
        previous = now;
        peakRows = Math.max(peakRows, scroller.querySelectorAll('li').length);
        if (first()) break;
      }
      seconds = (previous - started) / 1000;
      return { frames, peakRows, seconds, heightPx: scroller.scrollHeight };
    }, pixelsPerFrame);
  const summary = (scroll: Awaited<ReturnType<typeof measureScroll>>) => ({
    seconds: Math.round(scroll.seconds),
    frames: scroll.frames.length,
    fps: Math.round(scroll.frames.length / (scroll.frames.reduce((a, b) => a + b, 0) / 1000)),
    frameP50Ms: Math.round(percentile(scroll.frames, 0.5)),
    frameP95Ms: Math.round(percentile(scroll.frames, 0.95)),
    framesOver50Ms: scroll.frames.filter((frame) => frame > 50).length,
    worstFrameMs: Math.round(Math.max(...scroll.frames)),
    rowsInPageAtMost: scroll.peakRows,
    listHeightPx: scroll.heightPx,
  });
  const reading = await measureScroll(240);
  const fling = await measureScroll(2000);

  const numbers = {
    chatListMedianMs: Math.round(percentile(listTimes, 0.5)),
    chatListWorstMs: Math.round(Math.max(...listTimes)),
    openLongChatMs: Math.round(openMs),
    reading: summary(reading),
    fling: summary(fling),
  };
  // biome-ignore lint/suspicious/noConsole: these numbers are what this test is for
  console.log(`PERFORMANCE ${JSON.stringify(numbers)}`);
  testInfo.annotations.push({ type: 'performance', description: JSON.stringify(numbers) });

  // Virtualized: the page holds only rows near the viewport, however long the chat is.
  expect(Math.max(reading.peakRows, fling.peakRows)).toBeLessThan(200);
  await context.close();
});
