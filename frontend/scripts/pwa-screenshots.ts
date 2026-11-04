/**
 * Captures the manifest screenshots (shown in the browser's install dialog) from the design preview.
 *   pnpm --filter @zuvo/frontend pwa:screenshots [baseUrl]
 * Needs a running app: `pnpm dev` (default http://127.0.0.1:5191) or `vite preview`.
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const base = process.argv[2] ?? 'http://127.0.0.1:5191';
const outDir = fileURLToPath(new URL('../public/screenshots/', import.meta.url));
mkdirSync(outDir, { recursive: true });

const shots = [
  {
    file: 'wide.png',
    path: '/chats/design-team',
    viewport: { width: 1280, height: 800 },
    scale: 1,
  },
  { file: 'narrow.png', path: '/chats', viewport: { width: 390, height: 844 }, scale: 2 },
];

const browser = await chromium.launch();
for (const shot of shots) {
  const context = await browser.newContext({
    viewport: shot.viewport,
    deviceScaleFactor: shot.scale,
    colorScheme: 'light',
    isMobile: shot.scale > 1,
  });
  const page = await context.newPage();
  await page.goto(base + shot.path);
  await page.getByRole('heading', { name: 'Chats' }).waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${outDir}${shot.file}` });
  await context.close();
}
await browser.close();
process.stdout.write(`Saved ${shots.length} screenshots to ${outDir}\n`);
