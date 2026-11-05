import { closeSync, ftruncateSync, openSync, writeFileSync } from 'node:fs';
import { expect, type Page, type TestInfo, test } from '@playwright/test';
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

const MB = 1024 * 1024;

/** A real, playable video, made by the browser, padded so that it takes a while to upload. */
async function largeVideo(page: Page, testInfo: TestInfo, bytes: number) {
  const encoded = await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 240;
    const context = canvas.getContext('2d');
    const recorder = new MediaRecorder(canvas.captureStream(15), { mimeType: 'video/webm' });
    const parts: Blob[] = [];
    recorder.ondataavailable = (event) => parts.push(event.data);
    recorder.start();
    for (let frame = 0; frame < 30; frame += 1) {
      if (context) {
        context.fillStyle = `hsl(${frame * 12},80%,50%)`;
        context.fillRect(0, 0, 320, 240);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    await new Promise((resolve) => {
      recorder.onstop = resolve;
      recorder.stop();
    });
    const data = new Uint8Array(await new Blob(parts).arrayBuffer());
    return btoa(Array.from(data, (byte) => String.fromCharCode(byte)).join(''));
  });
  const path = testInfo.outputPath('long.webm');
  writeFileSync(path, Buffer.from(encoded, 'base64'));
  const file = openSync(path, 'r+');
  ftruncateSync(file, bytes);
  closeSync(file);
  return path;
}

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

async function sendVideo(page: Page, path: string) {
  await page.getByRole('button', { name: 'Attach a file' }).click();
  await page.getByTestId('pick-media').setInputFiles(path);
  await page.getByRole('dialog').getByRole('button', { name: 'Send', exact: true }).click();
}

const theirVideo = (page: Page) =>
  page.getByRole('list', { name: 'Asha', exact: true }).getByRole('button', { name: /Open video/ });

async function expectSenderSettled(page: Page) {
  const thread = page.getByRole('list', { name: 'Bharat', exact: true });
  await expect(page.getByRole('button', { name: /Cancel upload/ })).toHaveCount(0, SLOW);
  await expect(thread.getByRole('button', { name: /Open video/ })).toBeVisible(SLOW);
  await expect(thread.getByRole('img', { name: 'Sending' })).toHaveCount(0, SLOW);
  await expect(
    page.getByRole('link', { name: /Bharat/ }).getByRole('img', { name: 'Sending' }),
  ).toHaveCount(0, SLOW);
}

// These need the Chrome DevTools protocol to slow the upload, and a browser that records WebM.
test.beforeEach(({ browserName }) => {
  test.skip(browserName !== 'chromium', 'Slowing an upload needs the Chrome DevTools protocol');
});

test('after a slow upload of a large video, the sender sees it as sent', async ({
  browser,
}, testInfo) => {
  const [asha, bharat] = await chatting(browser);
  const path = await largeVideo(asha.page, testInfo, 80 * MB);
  const devtools = await asha.context.newCDPSession(asha.page);
  await devtools.send('Network.enable');
  await devtools.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 20,
    downloadThroughput: -1,
    uploadThroughput: 5 * MB,
  });

  await sendVideo(asha.page, path);
  await expect(asha.page.getByRole('button', { name: /Cancel upload/ })).toBeVisible(SLOW);
  await expect(theirVideo(bharat.page)).toBeVisible({ timeout: 120_000 });
  await expectSenderSettled(asha.page);
});

test('if the answer to sending it is lost, the sender still sees it as sent', async ({
  browser,
}, testInfo) => {
  const [asha, bharat] = await chatting(browser);
  const path = await largeVideo(asha.page, testInfo, 20 * MB);
  let lose = 0;
  await asha.context.routeWebSocket(/socket\.io/, (socket) => {
    const server = socket.connectToServer();
    socket.onMessage((message) => server.send(message));
    server.onMessage((message) => {
      const text = String(message);
      const isAnswer = /^43\d*\[/.test(text) && text.includes('messageId');
      const isNews = text.startsWith('42') && /message:new|chat:updated/.test(text);
      if (lose > 0 && (isAnswer || isNews)) {
        if (isAnswer) lose -= 1;
        return;
      }
      socket.send(message);
    });
  });
  await asha.page.reload();
  await expect(asha.page.getByRole('button', { name: 'Attach a file' })).toBeVisible(SLOW);

  lose = 1;
  await sendVideo(asha.page, path);
  await expect(theirVideo(bharat.page)).toBeVisible({ timeout: 120_000 });
  await expectSenderSettled(asha.page);
});

test('an expired video link is renewed, and the video plays', async ({ browser }, testInfo) => {
  const [asha, bharat] = await chatting(browser);
  await sendVideo(asha.page, await largeVideo(asha.page, testInfo, 2 * MB));
  await expect(theirVideo(bharat.page)).toBeVisible({ timeout: 120_000 });

  // As the server answers a link past its 15 minutes.
  let refused = 0;
  const links: string[] = [];
  bharat.page.on('request', (request) => {
    if (request.url().includes('/link')) links.push(request.url());
  });
  await bharat.page.route('**/v1/media/*/content?*sig=*', async (route) => {
    if (refused === 0) {
      refused += 1;
      await route.fulfill({ status: 403, json: { code: 'MEDIA_LINK_INVALID' } });
    } else await route.continue();
  });

  await theirVideo(bharat.page).click();
  const player = bharat.page.locator('video');
  await expect
    .poll(() => player.evaluate((video: HTMLVideoElement) => video.readyState), SLOW)
    .toBeGreaterThan(0);
  expect(refused).toBe(1);
  expect(links).toHaveLength(2);
  await expect(bharat.page.getByText('Media not available')).toHaveCount(0);
});
