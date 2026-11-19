import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  type Browser,
  type BrowserContextOptions,
  expect,
  type Page,
  test,
} from '@playwright/test';
import { SLOW } from '../helpers';
import { seed } from './seed';

/**
 * The message composer, for design reviews: desktop and a 375 px phone, light and dark, empty, with
 * three lines, and with more than fits (it scrolls inside). Also Help → About. Run by hand, like
 * screens.visual.ts (same config): SHOTS=before|after picks the file name prefix.
 *   pnpm exec playwright test -c e2e/visual/visual.config.ts composer
 * Screenshots: test-results/visual/composer-<SHOTS>-<viewport>-<theme>-<state>.png
 */
const OUT = new URL('../../test-results/visual/', import.meta.url);
const LABEL = process.env.SHOTS ?? 'now';

const VIEWPORTS: { name: string; options: BrowserContextOptions }[] = [
  { name: 'desktop', options: { viewport: { width: 1366, height: 768 } } },
  {
    name: 'phone375',
    options: {
      viewport: { width: 375, height: 812 },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
    },
  },
];

const THREE_LINES = 'First line of a message\nsecond line\nand a third one';
const LONG = Array.from({ length: 12 }, (_, i) => `Line ${i + 1} of a long message`).join('\n');

async function shot(page: Page, name: string) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: fileURLToPath(new URL(`composer-${LABEL}-${name}.png`, OUT)) });
}

async function context(
  browser: Browser,
  options: BrowserContextOptions,
  theme: string,
  state: string,
) {
  return browser.newContext({
    ...options,
    colorScheme: theme as 'light' | 'dark',
    storageState: JSON.parse(state),
  });
}

test('composer screenshots, before and after a redesign', async ({ browser }) => {
  test.setTimeout(15 * 60_000);
  mkdirSync(OUT, { recursive: true });
  const data = await seed(browser);
  const state = JSON.stringify(await data.asha.context.storageState());
  for (const viewport of VIEWPORTS) {
    for (const theme of ['light', 'dark']) {
      const ctx = await context(browser, viewport.options, theme, state);
      const page = await ctx.newPage();
      const name = `${viewport.name}-${theme}`;
      await page.goto(`/chats/${data.directId}`);
      const field = page.getByRole('textbox', { name: 'Write a message' });
      await expect(field).toBeVisible(SLOW);
      await shot(page, `${name}-empty`);
      await field.fill(THREE_LINES);
      await shot(page, `${name}-three-lines`);
      await field.fill(LONG);
      await shot(page, `${name}-long`);
      await field.fill('');
      await page.goto('/help/about');
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible(SLOW);
      await shot(page, `${name}-about`);
      await ctx.close();
    }
  }
});
