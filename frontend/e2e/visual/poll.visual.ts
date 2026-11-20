import { copyFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { createGroup, openFromList, thread } from '../chat-helpers';
import { SLOW, signUpByApi } from '../helpers';
import { createPoll } from '../poll-helpers';

// Polls in a group, on both sides of the conversation, light and dark, desktop and phone: for design
// reviews (before/after). Run by hand:
//
//   pnpm exec vite build --outDir test-results/visual-build --emptyOutDir
//   POLL_OUT=<folder> POLL_TAG=before pnpm exec playwright test -c e2e/visual/visual.config.ts poll
//
// POLL_OUT gets <tag>-<viewport>-<theme>-<side>.png.

const OUT = new URL('../../test-results/visual-poll/', import.meta.url);
const TAG = process.env.POLL_TAG ?? 'now';
const GROUP = 'Offsite';
const QUESTION = 'Where should the offsite be?';

async function person(browser: Browser, name: string, viewport: { width: number; height: number }) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const username = `${name.toLowerCase()}${Math.random().toString(36).slice(2, 10)}`;
  const email = await signUpByApi(page, name, username);
  return { context, page, name, username, email };
}

async function shoot(page: Page, name: string) {
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
      document.documentElement.dataset.accent = 'indigo';
    }, theme);
    await page.waitForTimeout(400);
    const path = fileURLToPath(new URL(`${TAG}-${name}-${theme}.png`, OUT));
    await page.screenshot({ path });
    if (process.env.POLL_OUT)
      copyFileSync(path, `${process.env.POLL_OUT}/${TAG}-${name}-${theme}.png`);
  }
}

test('polls on both sides, light and dark, desktop and phone', async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  for (const [label, viewport] of [
    ['desktop', { width: 1366, height: 768 }],
    ['phone', { width: 390, height: 844 }],
  ] as const) {
    const asha = await person(browser, 'Asha', viewport);
    const bharat = await person(browser, 'Bharat', viewport);
    const chitra = await person(browser, 'Chitra', viewport);
    await createGroup(asha.page, GROUP, [bharat, chitra]);
    await createPoll(asha.page, QUESTION, ['Goa', 'Coorg', 'Rishikesh']);
    for (const other of [bharat, chitra]) {
      await expect(other.page.getByRole('link', { name: new RegExp(GROUP) })).toBeVisible(SLOW);
      await openFromList(other.page, GROUP);
      await expect(thread(other.page, GROUP).getByText(QUESTION)).toBeVisible(SLOW);
    }
    // Bharat and Chitra vote Goa; Asha votes Coorg; Rishikesh stays at 0.
    await thread(bharat.page, GROUP).getByText('Goa', { exact: true }).click();
    await thread(chitra.page, GROUP).getByText('Goa', { exact: true }).click();
    await thread(asha.page, GROUP).getByText('Coorg', { exact: true }).click();
    await asha.page.waitForTimeout(1500);
    await shoot(asha.page, `${label}-outgoing`);
    await shoot(bharat.page, `${label}-incoming`);
    const viewVotes = asha.page.getByRole('button', { name: 'View votes' });
    if (await viewVotes.isVisible().catch(() => false)) {
      await viewVotes.click();
      await asha.page.waitForTimeout(600);
      await shoot(asha.page, `${label}-view-votes`);
    }
    for (const who of [asha, bharat, chitra]) await who.context.close();
  }
});
