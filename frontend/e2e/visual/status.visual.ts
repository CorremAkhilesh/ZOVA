import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  expect,
  type Page,
  test,
} from '@playwright/test';
import { SLOW, signUpByApi } from '../helpers';

// The Status screens in every viewport and theme, with axe on each: the list, someone's photo,
// text and wide photo statuses, my own (Viewed by), its ⋯ menu and the delete question. Run by hand:
//
//   pnpm exec vite build --outDir test-results/visual-build --emptyOutDir
//   STATUS_OUT=<folder> pnpm exec playwright test -c e2e/visual/visual.config.ts status
//
// STATUS_OUT gets <viewport>-<theme>-<screen>.png and axe.json (also in test-results/visual-status).

const OUT = new URL('../../test-results/visual-status/', import.meta.url);
const STATUS_OUT = process.env.STATUS_OUT;
const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
);
type Theme = 'light' | 'dark';
const VIEWPORTS: { name: string; options: BrowserContextOptions }[] = [
  { name: 'desktop1920', options: { viewport: { width: 1920, height: 1080 } } },
  { name: 'desktop1366', options: { viewport: { width: 1366, height: 768 } } },
  { name: 'tablet', options: { viewport: { width: 768, height: 1024 }, hasTouch: true } },
  {
    name: 'phone',
    options: { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true },
  },
];
const violations: { shot: string; id: string; impact: string | null; targets: string[] }[] = [];

async function shoot(page: Page, name: string) {
  await page.waitForTimeout(500);
  const path = fileURLToPath(new URL(`${name}.png`, OUT));
  await page.screenshot({ path });
  if (STATUS_OUT) copyFileSync(path, `${STATUS_OUT}/${name}.png`);
  await page.evaluate(AXE_SOURCE);
  const found = await page.evaluate(async () => {
    // biome-ignore lint/suspicious/noExplicitAny: axe is injected as a global script
    const run = await (window as any).axe.run(document, { resultTypes: ['violations'] });
    return run.violations.map(
      (v: { id: string; impact: string | null; nodes: { target: string[] }[] }) => ({
        id: v.id,
        impact: v.impact,
        targets: v.nodes.map((n) => n.target.join(' ')),
      }),
    );
  });
  for (const v of found) violations.push({ shot: name, ...v });
}

/** A picture drawn in the page: a soft scene, so the shots look like a real photo status. */
async function picture(page: Page, width: number, height: number, hue: number): Promise<Buffer> {
  const data = await page.evaluate(
    ([w, h, base]) => {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const g = canvas.getContext('2d') as CanvasRenderingContext2D;
      const sky = g.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, `hsl(${base} 70% 72%)`);
      sky.addColorStop(1, `hsl(${base + 40} 60% 45%)`);
      g.fillStyle = sky;
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'hsl(45 95% 70%)';
      g.beginPath();
      g.arc(w * 0.72, h * 0.28, Math.min(w, h) * 0.12, 0, Math.PI * 2);
      g.fill();
      for (let i = 0; i < 3; i++) {
        g.fillStyle = `hsl(${base + 90} 35% ${30 - i * 7}%)`;
        g.beginPath();
        g.moveTo(0, h);
        g.lineTo(w * (0.15 + i * 0.3), h * (0.55 + i * 0.08));
        g.lineTo(w * (0.55 + i * 0.25), h);
        g.fill();
      }
      return canvas.toDataURL('image/jpeg', 0.9).split(',')[1] as string;
    },
    [width, height, hue] as const,
  );
  return Buffer.from(data, 'base64');
}

async function account(browser: Browser, name: string) {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await signUpByApi(page, name);
  return { context, page };
}

async function postPhoto(page: Page, buffer: Buffer, caption: string) {
  await page.goto('/updates');
  await page.getByTestId('pick-status-media').setInputFiles({
    name: 'photo.jpg',
    mimeType: 'image/jpeg',
    buffer,
  });
  const sheet = page.getByRole('dialog', { name: 'New photo status' });
  if (caption) await sheet.getByRole('textbox', { name: 'Add a caption' }).fill(caption);
  await sheet.getByRole('button', { name: 'Post' }).click();
  await expect(sheet).toBeHidden(SLOW);
}

async function postText(page: Page, text: string, background: string) {
  const response = await page.request.post('/v1/statuses', {
    data: { kind: 'text', text, style: { background, font: 'sans' } },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).status.id as string;
}

/** Holds a finger (the mouse) on the picture: the status waits while the shot is taken. */
async function held(page: Page, work: () => Promise<void>) {
  const size = page.viewportSize() ?? { width: 800, height: 600 };
  await page.mouse.move(size.width / 2, size.height / 2);
  await page.mouse.down();
  await work();
  await page.keyboard.press('Escape');
  await page.mouse.up();
}

async function screens(context: BrowserContext, prefix: string, posterName: string) {
  const page = await context.newPage();
  await page.goto('/updates');
  await expect(page.getByRole('heading', { name: 'Status', level: 1 })).toBeVisible(SLOW);
  await shoot(page, `${prefix}-list`);
  const viewer = page.getByRole('dialog', { name: /status/ });
  const openPoster = async () => {
    await page.getByRole('button', { name: new RegExp(`^${posterName}`) }).click();
    await expect(viewer).toBeVisible(SLOW);
  };
  for (const [index, screen] of ['photo', 'text', 'wide'].entries()) {
    await openPoster();
    for (let step = 0; step < index; step++) await page.keyboard.press('ArrowRight');
    await held(page, () => shoot(page, `${prefix}-viewer-${screen}`));
    await expect(viewer).toBeHidden(SLOW);
  }
  await page.close();
}

async function ownScreens(context: BrowserContext, prefix: string) {
  const page = await context.newPage();
  await page.goto('/updates');
  await expect(page.getByRole('heading', { name: 'Status', level: 1 })).toBeVisible(SLOW);
  await shoot(page, `${prefix}-own-list`);
  await page.getByRole('button', { name: /^My status/ }).click();
  const viewer = page.getByRole('dialog', { name: 'My status' });
  await expect(viewer).toBeVisible(SLOW);
  await page.getByRole('button', { name: 'More options' }).click();
  await expect(page.getByRole('menuitem', { name: 'Delete status' })).toBeVisible(SLOW);
  await shoot(page, `${prefix}-own-menu`);
  await page.getByRole('menuitem', { name: 'Delete status' }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Delete this status?' });
  if (await confirm.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await shoot(page, `${prefix}-own-delete`);
    await confirm.getByRole('button', { name: 'Cancel' }).click();
  }
  await held(page, () => shoot(page, `${prefix}-own-viewer`));
  await page.close();
}

test('status screens in every viewport and theme, axe on each', async ({ browser }) => {
  mkdirSync(OUT, { recursive: true });
  const asha = await account(browser, 'Asha Mehta');
  const bharat = await account(browser, 'Bharat Iyer');
  const chitra = await account(browser, 'Chitra Nair');

  await postPhoto(
    asha.page,
    await picture(asha.page, 1080, 1350, 200),
    'Morning at the new office',
  );
  await postText(
    asha.page,
    'Quarter close moved to Friday 4 PM. Please send your numbers by Thursday evening 🙏',
    'indigo',
  );
  await postPhoto(asha.page, await picture(asha.page, 1600, 900, 150), '');
  await postText(chitra.page, 'Back from leave on Monday', 'teal');
  await postText(bharat.page, 'In Pune for the client visit', 'rose');
  // Chitra's is new for Bharat (Recent updates); Asha's are all seen (Viewed updates, and each
  // opening starts at her first). Bharat reacted to her first one: "Viewed by 1" for Asha.
  const feed = await (await asha.page.request.get('/v1/statuses')).json();
  for (const [index, status] of (feed.mine as { id: string }[]).entries()) {
    await bharat.page.request.post(`/v1/statuses/${status.id}/view`, {
      data: index === 0 ? { reaction: '👍' } : {},
    });
  }
  const bharatState = JSON.stringify(await bharat.context.storageState());
  const ashaState = JSON.stringify(await asha.context.storageState());
  for (const vp of VIEWPORTS) {
    for (const theme of ['light', 'dark'] as Theme[]) {
      const make = (state: string) =>
        browser.newContext({
          ...vp.options,
          colorScheme: theme,
          reducedMotion: 'reduce',
          storageState: JSON.parse(state),
        });
      const viewing = await make(bharatState);
      await screens(viewing, `${vp.name}-${theme}`, 'Asha Mehta');
      await viewing.close();
      const own = await make(ashaState);
      await ownScreens(own, `${vp.name}-${theme}`);
      await own.close();
    }
  }
  const report = JSON.stringify(violations, null, 2);
  writeFileSync(fileURLToPath(new URL('axe.json', OUT)), report);
  if (STATUS_OUT) writeFileSync(`${STATUS_OUT}/axe.json`, report);
});
