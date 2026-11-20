import { type Browser, expect, type Page, test } from '@playwright/test';
import {
  expectSent,
  newPerson,
  openChatWith,
  openFromList,
  type Person,
  send,
  thread,
} from './chat-helpers';
import { open, SLOW } from './helpers';

// 1:1 voice calls between two real browsers (Chromium's fake microphone, desktop and phone screen):
// call → accept → connected on both sides → mute → end → the call history and the line in the chat;
// declined; missed after the ringing time; busy while on another call.

test.skip(
  ({ browserName }) => browserName !== 'chromium',
  'A fake microphone and WebRTC between two pages need Chromium launch flags (playwright.config FAKE_MIC)',
);
test.describe.configure({ timeout: 180_000 });

const callScreen = (page: Page, name: string) => page.getByRole('dialog', { name });
/** "0:07": the timer runs only once audio flows both ways. */
const TIMER = /^\d+:\d{2}$/;

/**
 * The other person's voice really arrives: the call's audio element plays a stream whose level is
 * above silence (Chromium's fake microphone sends a beep). Polled, since audio starts a moment after
 * the connection.
 */
async function hearsTheOtherSide(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const audio = document.querySelector<HTMLAudioElement>('audio[data-call-audio]');
          const stream = audio?.srcObject;
          if (!(stream instanceof MediaStream) || stream.getAudioTracks().length === 0) return 0;
          const context = new AudioContext();
          const analyser = context.createAnalyser();
          context.createMediaStreamSource(stream).connect(analyser);
          const samples = new Float32Array(analyser.fftSize);
          let peak = 0;
          for (let n = 0; n < 20; n++) {
            await new Promise((resolve) => setTimeout(resolve, 50));
            analyser.getFloatTimeDomainData(samples);
            for (const value of samples) peak = Math.max(peak, Math.abs(value));
          }
          await context.close();
          return peak;
        }),
      { timeout: 30_000, message: 'no audio from the other side' },
    )
    .toBeGreaterThan(0.01);
}

/** Two people with a 1:1 chat open on both sides. */
async function pair(browser: Browser): Promise<[Person, Person]> {
  const asha = await newPerson(browser, 'Asha');
  const bharat = await newPerson(browser, 'Bharat');
  await openChatWith(asha.page, bharat);
  await send(asha.page, 'call me');
  await expectSent(asha.page, bharat.name, 'call me');
  await openFromList(bharat.page, asha.name);
  return [asha, bharat];
}

async function call(from: Person, to: Person) {
  await from.page.getByRole('button', { name: `Voice call with ${to.name}` }).click();
  await expect(callScreen(from.page, to.name)).toBeVisible(SLOW);
}

async function close(...people: Person[]) {
  for (const person of people) await person.context.close();
}

test('call → accept → connected both ways → mute → end → history and the chat line', async ({
  browser,
}) => {
  const [asha, bharat] = await pair(browser);
  await call(asha, bharat);
  await expect(callScreen(asha.page, bharat.name)).toContainText(/Calling…|Ringing…/);

  const ringing = callScreen(bharat.page, asha.name);
  await expect(ringing).toContainText('Incoming voice call', SLOW);
  await expect(callScreen(asha.page, bharat.name)).toContainText('Ringing…', SLOW);
  await ringing.getByRole('button', { name: 'Accept' }).click();

  // Connected: the timer runs on both sides (only after ICE connects and audio flows).
  await expect(callScreen(asha.page, bharat.name).getByText(TIMER)).toBeVisible(SLOW);
  await expect(callScreen(bharat.page, asha.name).getByText(TIMER)).toBeVisible(SLOW);
  // And the voices: each side hears the other.
  await hearsTheOtherSide(asha.page);
  await hearsTheOtherSide(bharat.page);

  const mute = callScreen(bharat.page, asha.name).getByRole('button', { name: 'Mute' });
  await mute.click();
  await expect(
    callScreen(bharat.page, asha.name).getByRole('button', { name: 'Unmute' }),
  ).toHaveAttribute('aria-pressed', 'true');

  await asha.page.waitForTimeout(2000);
  await callScreen(asha.page, bharat.name).getByRole('button', { name: 'End call' }).click();
  await expect(callScreen(bharat.page, asha.name)).toContainText('Call ended', SLOW);
  await expect(callScreen(bharat.page, asha.name)).toBeHidden(SLOW);
  await expect(callScreen(asha.page, bharat.name)).toBeHidden(SLOW);

  // The line in the chat, for both.
  await expect(thread(asha.page, bharat.name).getByText(/^Voice call · \d+:\d{2}$/)).toBeVisible(
    SLOW,
  );
  await expect(thread(bharat.page, asha.name).getByText(/^Voice call · \d+:\d{2}$/)).toBeVisible(
    SLOW,
  );

  // And the history, with a way to call back.
  await open(bharat.page, '/calls');
  const bharatLog = bharat.page.getByRole('list', { name: 'Calls' });
  await expect(bharatLog.getByRole('listitem').first()).toContainText('Incoming', SLOW);
  await expect(bharatLog.getByRole('listitem').first()).toContainText(asha.name, SLOW);
  await expect(bharatLog.getByRole('button', { name: `Call ${asha.name}` })).toBeVisible();
  await open(asha.page, '/calls');
  await expect(
    asha.page.getByRole('list', { name: 'Calls' }).getByRole('listitem').first(),
  ).toContainText('Outgoing', SLOW);
  await close(asha, bharat);
});

test('declined: the caller hears so, and the chat says it', async ({ browser }) => {
  const [asha, bharat] = await pair(browser);
  await call(asha, bharat);
  await callScreen(bharat.page, asha.name).getByRole('button', { name: 'Decline' }).click({
    timeout: 30_000,
  });
  await expect(callScreen(asha.page, bharat.name)).toContainText('Declined', SLOW);
  await expect(thread(asha.page, bharat.name).getByText('Voice call · No answer')).toBeVisible(
    SLOW,
  );
  await expect(thread(bharat.page, asha.name).getByText('Declined voice call')).toBeVisible(SLOW);
  await close(asha, bharat);
});

test('missed: nobody answers within the ringing time', async ({ browser }) => {
  const [asha, bharat] = await pair(browser);
  await call(asha, bharat);
  await expect(callScreen(bharat.page, asha.name)).toBeVisible(SLOW);
  // 45 seconds of ringing, then it stops everywhere.
  await expect(callScreen(asha.page, bharat.name)).toContainText('No answer', { timeout: 75_000 });
  await expect(callScreen(bharat.page, asha.name)).toBeHidden(SLOW);
  await expect(thread(bharat.page, asha.name).getByText('Missed voice call')).toBeVisible(SLOW);
  await open(bharat.page, '/calls');
  await expect(
    bharat.page.getByRole('list', { name: 'Calls' }).getByRole('listitem').first(),
  ).toContainText('Missed', SLOW);
  await close(asha, bharat);
});

test('busy: someone on a call cannot be rung; the caller is told and they get a missed call', async ({
  browser,
}) => {
  const [asha, bharat] = await pair(browser);
  const chitra = await newPerson(browser, 'Chitra');
  await openChatWith(chitra.page, bharat);
  await send(chitra.page, 'are you free?');
  await expectSent(chitra.page, bharat.name, 'are you free?');

  await call(asha, bharat);
  await callScreen(bharat.page, asha.name).getByRole('button', { name: 'Accept' }).click({
    timeout: 30_000,
  });
  await expect(callScreen(asha.page, bharat.name).getByText(TIMER)).toBeVisible(SLOW);

  await chitra.page.getByRole('button', { name: `Voice call with ${bharat.name}` }).click();
  await expect(callScreen(chitra.page, bharat.name)).toContainText('On another call', SLOW);
  // Bharat's call goes on, untouched.
  await expect(callScreen(bharat.page, asha.name).getByText(TIMER)).toBeVisible();
  await callScreen(bharat.page, asha.name).getByRole('button', { name: 'End call' }).click();
  await open(bharat.page, '/calls');
  const log = bharat.page.getByRole('list', { name: 'Calls' });
  await expect(log.getByRole('listitem').filter({ hasText: chitra.name })).toContainText(
    'Missed',
    SLOW,
  );
  await close(asha, bharat, chitra);
});
