import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  type Browser,
  type BrowserContextOptions,
  expect,
  type Page,
  test,
} from '@playwright/test';
import { SLOW } from '../helpers';
import { GROUP_NAME, type Seeded, seed } from './seed';

const OUT = new URL('../../test-results/visual/', import.meta.url);
const AXE = createRequire(import.meta.url).resolve('axe-core/axe.min.js');

type Theme = 'light' | 'dark';
interface Viewport {
  name: string;
  options: BrowserContextOptions;
}

const VIEWPORTS: Viewport[] = [
  { name: 'desktop1920', options: { viewport: { width: 1920, height: 1080 } } },
  { name: 'desktop1366', options: { viewport: { width: 1366, height: 768 } } },
  {
    name: 'tablet',
    options: { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true },
  },
  {
    name: 'phone',
    options: {
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      hasTouch: true,
      isMobile: true,
    },
  },
];

interface Violation {
  shot: string;
  id: string;
  impact: string | null;
  help: string;
  targets: string[];
}
const violations: Violation[] = [];
const shots: string[] = [];

async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page.waitForTimeout(400);
}

/** Screenshot + axe (every rule, contrast included) for one screen. */
async function shoot(page: Page, name: string) {
  await settle(page);
  await page.screenshot({ path: fileURLToPath(new URL(`${name}.png`, OUT)), fullPage: true });
  shots.push(`frontend/test-results/visual/${name}.png`);
  await page.addScriptTag({ path: AXE });
  const result = await page.evaluate(async () => {
    // biome-ignore lint/suspicious/noExplicitAny: axe is injected as a global script
    const axe = (window as any).axe;
    const run = await axe.run(document, { resultTypes: ['violations'] });
    return run.violations.map(
      (v: { id: string; impact: string | null; help: string; nodes: { target: string[] }[] }) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        targets: v.nodes.map((n) => n.target.join(' ')),
      }),
    );
  });
  for (const v of result as Omit<Violation, 'shot'>[]) violations.push({ shot: name, ...v });
  const sideways = await page.evaluate(horizontalOverflow);
  if (sideways.length > 0)
    violations.push({
      shot: name,
      id: 'horizontal-scroll',
      impact: 'serious',
      help: 'Content wider than its box',
      targets: sideways,
    });
}

/** Boxes (and the page) that would scroll sideways; folder chips and code blocks are meant to. */
function horizontalOverflow(): string[] {
  const wide = (element: Element) => element.scrollWidth > element.clientWidth + 1;
  const found: string[] = [];
  if (wide(document.documentElement)) found.push('html');
  for (const element of document.querySelectorAll('body *')) {
    const style = getComputedStyle(element);
    if (!['auto', 'scroll'].includes(style.overflowX) || !wide(element)) continue;
    if (element.closest('.chip-row, pre, [data-scroll-x]')) continue;
    const edge = element.getBoundingClientRect().right;
    const culprit = [...element.querySelectorAll('*')]
      .filter((child) => child.getBoundingClientRect().right > edge + 1)
      .at(-1);
    const name = (node: Element | undefined) =>
      node ? `${node.tagName.toLowerCase()}.${[...node.classList].slice(0, 4).join('.')}` : '';
    found.push(`${name(element)} (too wide: ${name(culprit)})`);
  }
  return found;
}

async function openPalette(page: Page) {
  const box = page.getByRole('combobox', { name: /Search chats|चैट/ });
  await expect(async () => {
    await page.keyboard.press('Control+k');
    await expect(box).toBeVisible({ timeout: 3_000 });
  }).toPass(SLOW);
}

async function chatInfo(page: Page) {
  // The header's name button, in any language: it opens chat info at every width.
  await page.locator('[data-info-toggle]').click();
  await page.waitForTimeout(300);
}

async function shootAll(page: Page, prefix: string, data: Seeded, hindi = false) {
  await page.goto('/chats');
  await expect(page.getByRole('link', { name: /Quarterly/ })).toBeVisible(SLOW);
  await shoot(page, `${prefix}-chat-list`);

  await page.goto(`/chats/${data.directId}`);
  await expect(page.getByRole('textbox').last()).toBeVisible(SLOW);
  await shoot(page, `${prefix}-conversation`);

  await page.goto(`/chats/${data.groupId}`);
  await expect(page.getByRole('heading', { name: GROUP_NAME }).first()).toBeAttached(SLOW);
  await shoot(page, `${prefix}-group`);
  await chatInfo(page);
  await shoot(page, `${prefix}-group-info`);
  await page.keyboard.press('Escape');

  await page.goto('/settings');
  await shoot(page, `${prefix}-settings`);
  await page.goto('/settings/notifications');
  await shoot(page, `${prefix}-notifications`);
  await page.goto('/help');
  await shoot(page, `${prefix}-help`);

  await page.goto('/chats');
  await openPalette(page);
  await shoot(page, `${prefix}-palette`);
  await page.keyboard.press('Escape');

  await page
    .getByRole('button', { name: hindi ? /नई चैट/ : 'New chat' })
    .first()
    .click();
  await expect(page.getByRole('dialog')).toBeVisible(SLOW);
  await shoot(page, `${prefix}-dialog`);
  await page.keyboard.press('Escape');
}

async function signedIn(browser: Browser, vp: Viewport, theme: Theme, state: string) {
  const context = await browser.newContext({
    ...vp.options,
    colorScheme: theme,
    reducedMotion: 'reduce',
    storageState: JSON.parse(state),
  });
  return context;
}

test('visual sanity: key screens in every viewport and theme, axe on each', async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  const data = await seed(browser);
  const state = JSON.stringify(await data.asha.context.storageState());
  const only = process.env.VISUAL_ONLY?.split(',');

  for (const vp of VIEWPORTS) {
    if (only && !only.includes(vp.name)) continue;
    for (const theme of ['light', 'dark'] as Theme[]) {
      const welcome = await browser.newContext({
        ...vp.options,
        colorScheme: theme,
        reducedMotion: 'reduce',
      });
      const signedOut = await welcome.newPage();
      await signedOut.goto('/');
      await expect(signedOut.getByRole('textbox', { name: 'Work email' })).toBeVisible(SLOW);
      await shoot(signedOut, `${vp.name}-${theme}-welcome`);
      await welcome.close();

      const context = await signedIn(browser, vp, theme, state);
      await shootAll(await context.newPage(), `${vp.name}-${theme}`, data);
      await context.close();
    }
  }

  // Hindi on a phone, light and dark.
  const phone = VIEWPORTS.find((vp) => vp.name === 'phone') as Viewport;
  if (!only || only.includes('hindi')) {
    for (const theme of ['light', 'dark'] as Theme[]) {
      const context = await signedIn(browser, phone, theme, state);
      const page = await context.newPage();
      await page.goto('/settings');
      await page.getByRole('radio', { name: 'हिन्दी' }).click();
      await expect(page.locator('html')).toHaveAttribute('lang', 'hi', SLOW);
      await shootAll(page, `phone-hi-${theme}`, data, true);
      await context.close();
    }
  }

  writeFileSync(new URL('axe.json', OUT), JSON.stringify(violations, null, 2));
  writeFileSync(new URL('shots.txt', OUT), shots.join('\n'));
  // biome-ignore lint/suspicious/noConsole: a run by hand; the summary is its output
  console.log(`${shots.length} screenshots, ${violations.length} axe violations`);
  // biome-ignore lint/suspicious/noConsole: a run by hand; the summary is its output
  for (const v of violations) console.log(`${v.shot}: [${v.impact}] ${v.id} — ${v.targets[0]}`);
  expect.soft(violations).toEqual([]);
});
