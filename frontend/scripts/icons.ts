/**
 * Generates every PWA icon and iOS splash screen from public/icons/source.svg.
 *   pnpm --filter @zuvo/frontend icons
 * Renders with Playwright's Chromium (already installed for E2E), so no native image library is needed.
 */
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import { darkColors, lightColors } from '@zuvo/ui-tokens';
import {
  APPLE_TOUCH_ICON,
  ICONS_DIR,
  IOS_SPLASH_DEVICES,
  MANIFEST_ICONS,
  SPLASH_DIR,
  SPLASH_THEMES,
  splashFile,
} from '../pwa/assets.ts';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const source = readFileSync(`${publicDir}icons/source.svg`, 'utf8');

/** The "Z" glyph alone (from source.svg), for full-bleed and splash layouts. */
const GLYPH =
  '<path d="M20 22h24L22 42h22" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>';
const GRADIENT =
  '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4F46E5"/><stop offset="1" stop-color="#14B8A6"/></linearGradient></defs>';

/** Full-bleed square: the OS applies its own mask. Glyph stays inside the central 80% safe zone. */
const fullBleed = (glyphScale: number) => {
  const offset = 32 - 32 * glyphScale;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${GRADIENT}<rect width="64" height="64" fill="url(#g)"/><g transform="translate(${offset} ${offset}) scale(${glyphScale})">${GLYPH}</g></svg>`;
};

async function render(
  page: Page,
  svg: string,
  width: number,
  height: number,
  background: string,
  out: string,
) {
  await page.setViewportSize({ width, height });
  await page.setContent(
    `<html><body style="margin:0;width:${width}px;height:${height}px;background:${background};display:grid;place-items:center">${svg}</body></html>`,
  );
  await page.screenshot({ path: out, omitBackground: background === 'transparent' });
}

const sized = (svg: string, size: number) =>
  svg.replace('<svg ', `<svg width="${size}" height="${size}" `);

const browser = await chromium.launch();
const page = await browser.newPage();
mkdirSync(`${publicDir}${SPLASH_DIR}`, { recursive: true });

copyFileSync(`${publicDir}icons/source.svg`, `${publicDir}favicon.svg`);

for (const icon of MANIFEST_ICONS) {
  // Maskable: full bleed, glyph shrunk into the safe zone. "any": the rounded tile as designed.
  const svg = icon.purpose === 'maskable' ? fullBleed(0.8) : source;
  await render(
    page,
    sized(svg, icon.size),
    icon.size,
    icon.size,
    'transparent',
    `${publicDir}${ICONS_DIR}/${icon.file}`,
  );
}

// iOS rounds the corners itself and shows transparency as black, so: full bleed, opaque.
await render(
  page,
  sized(fullBleed(0.9), APPLE_TOUCH_ICON.size),
  APPLE_TOUCH_ICON.size,
  APPLE_TOUCH_ICON.size,
  '#4F46E5',
  `${publicDir}${ICONS_DIR}/${APPLE_TOUCH_ICON.file}`,
);

for (const device of IOS_SPLASH_DEVICES) {
  for (const theme of SPLASH_THEMES) {
    const width = device.width * device.ratio;
    const height = device.height * device.ratio;
    const logo = Math.round(Math.min(width, height) * 0.28);
    const background = theme === 'dark' ? darkColors.background : lightColors.background;
    await render(
      page,
      sized(source, logo),
      width,
      height,
      background,
      `${publicDir}${SPLASH_DIR}/${splashFile(device, theme)}`,
    );
  }
}

await browser.close();
process.stdout.write(
  `Generated ${MANIFEST_ICONS.length + 2} icons and ${IOS_SPLASH_DEVICES.length * SPLASH_THEMES.length} splash screens.\n`,
);
