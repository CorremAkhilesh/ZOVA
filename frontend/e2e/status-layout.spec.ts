import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, type Page, test } from '@playwright/test';
import { newPerson } from './chat-helpers';
import { SLOW } from './helpers';

// The status viewer's layout at 1920 and 1366 (desktop), 768 (tablet) and 375 (phone): the photo
// whole, in its own shape, inside the window and above the reply box; ‹ › and the corner ✕ on wider
// screens, the "Reply" bar on a phone; big words on a text status; and axe finds nothing.

test.describe.configure({ timeout: 300_000 });

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const VIEWPORTS = [
  { name: 'desktop 1920', width: 1920, height: 1080 },
  { name: 'desktop 1366', width: 1366, height: 768 },
  { name: 'tablet 768', width: 768, height: 1024 },
  { name: 'phone 375', width: 375, height: 812 },
] as const;

/** A portrait photo (1080 × 1350), drawn in the page. */
async function portrait(page: Page): Promise<Buffer> {
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1350;
    const g = canvas.getContext('2d') as CanvasRenderingContext2D;
    const fill = g.createLinearGradient(0, 0, 0, 1350);
    fill.addColorStop(0, '#7dd3fc');
    fill.addColorStop(1, '#4338ca');
    g.fillStyle = fill;
    g.fillRect(0, 0, 1080, 1350);
    return canvas.toDataURL('image/jpeg', 0.85).split(',')[1] as string;
  });
  return Buffer.from(data, 'base64');
}

async function axeViolations(page: Page) {
  await page.evaluate(AXE);
  return page.evaluate(async () => {
    // biome-ignore lint/suspicious/noExplicitAny: axe is injected as a global script
    const result = await (window as any).axe.run(document, { resultTypes: ['violations'] });
    return result.violations.map((v: { id: string; nodes: { target: string[] }[] }) => ({
      id: v.id,
      targets: v.nodes.map((node) => node.target.join(' ')),
    }));
  });
}

test('the status viewer at desktop, tablet and phone widths', async ({ browser }) => {
  const name = `Tara${Math.random().toString(36).slice(2, 6)}`;
  const asha = await newPerson(browser, name);
  const bharat = await newPerson(browser, 'Bharat');
  await asha.page.goto('/updates');
  await asha.page.getByTestId('pick-status-media').setInputFiles({
    name: 'tall.jpg',
    mimeType: 'image/jpeg',
    buffer: await portrait(asha.page),
  });
  const sheet = asha.page.getByRole('dialog', { name: 'New photo status' });
  await sheet.getByRole('button', { name: 'Post' }).click();
  await expect(sheet).toBeHidden(SLOW);
  const text = await asha.page.request.post('/v1/statuses', {
    data: { kind: 'text', text: 'Team lunch at 1', style: { background: 'violet', font: 'sans' } },
  });
  expect(text.ok()).toBe(true);
  // Seen already: every opening starts at the photo.
  const mine = (await (await asha.page.request.get('/v1/statuses')).json()).mine as {
    id: string;
  }[];
  for (const status of mine) await bharat.page.request.post(`/v1/statuses/${status.id}/view`, {});
  const state = await bharat.context.storageState();

  for (const viewport of VIEWPORTS) {
    const wide = viewport.width >= 768;
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      storageState: state,
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    await page.goto('/updates');
    // Wider screens: the list beside a quiet pane.
    await expect(page.getByText('Choose a colleague to see their status updates')).toBeVisible({
      visible: wide,
      ...SLOW,
    });
    await page.getByRole('button', { name: new RegExp(`^${name}`) }).click();
    const viewer = page.getByRole('dialog', { name: `${name}’s status` });
    const photo = viewer.getByRole('img', { name: 'Photo' });
    await expect(photo).toBeVisible(SLOW);
    await expect
      .poll(() => photo.evaluate((img: HTMLImageElement) => img.complete), SLOW)
      .toBe(true);
    // Hold it still while measuring.
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.mouse.down();

    const box = await photo.boundingBox();
    if (!box) throw new Error(`${viewport.name}: no photo box`);
    expect(Math.abs(box.width / box.height - 1080 / 1350), viewport.name).toBeLessThan(0.02);
    expect(box.y, viewport.name).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, viewport.name).toBeLessThanOrEqual(viewport.height + 0.5);
    // Big on wider screens: most of the window's height.
    if (wide) expect(box.height, viewport.name).toBeGreaterThan(viewport.height * 0.6);
    const reply = wide
      ? viewer.getByRole('textbox', { name: `Reply to ${name}` })
      : viewer.getByRole('button', { name: 'Reply', exact: true });
    await expect(reply).toBeVisible();
    if (wide) {
      const replyBox = await reply.boundingBox();
      expect(box.y + box.height, viewport.name).toBeLessThanOrEqual((replyBox?.y ?? 0) + 0.5);
    }
    await expect(viewer.getByRole('button', { name: 'Next status' })).toBeVisible({
      visible: wide,
    });
    const close = viewer.getByRole('button', { name: 'Close status' });
    await expect(close).toBeVisible();
    const closeBox = await close.boundingBox();
    expect(viewport.width - ((closeBox?.x ?? 0) + (closeBox?.width ?? 0))).toBeLessThan(80);
    expect(await axeViolations(page), viewport.name).toEqual([]);
    await page.mouse.up();

    await page.keyboard.press('ArrowRight');
    const words = viewer.getByText('Team lunch at 1');
    await expect(words).toBeVisible(SLOW);
    const size = await words.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).fontSize),
    );
    expect(size, viewport.name).toBeGreaterThanOrEqual(36);
    await context.close();
  }
  await asha.context.close();
  await bharat.context.close();
});
