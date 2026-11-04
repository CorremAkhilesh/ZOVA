/**
 * PWA asset list, shared by `pnpm icons` (generates the files) and vite.config.ts (manifest and
 * iOS <link> tags), so the two never drift.
 */

export const ICONS_DIR = 'icons';
export const SPLASH_DIR = 'icons/splash';

export const MANIFEST_ICONS = [
  { file: 'icon-192.png', size: 192, purpose: 'any' },
  { file: 'icon-512.png', size: 512, purpose: 'any' },
  { file: 'maskable-512.png', size: 512, purpose: 'maskable' },
] as const;

export const APPLE_TOUCH_ICON = { file: 'apple-touch-icon.png', size: 180 } as const;

/** iOS launch images (portrait), in CSS pixels × device pixel ratio. */
export const IOS_SPLASH_DEVICES = [
  { name: 'iphone-16-pro-max', width: 440, height: 956, ratio: 3 },
  { name: 'iphone-16-pro', width: 402, height: 874, ratio: 3 },
  { name: 'iphone-15-pro-max', width: 430, height: 932, ratio: 3 },
  { name: 'iphone-15-pro', width: 393, height: 852, ratio: 3 },
  { name: 'iphone-14-plus', width: 428, height: 926, ratio: 3 },
  { name: 'iphone-14', width: 390, height: 844, ratio: 3 },
  { name: 'iphone-11-pro-max', width: 414, height: 896, ratio: 3 },
  { name: 'iphone-11', width: 414, height: 896, ratio: 2 },
  { name: 'iphone-x', width: 375, height: 812, ratio: 3 },
  { name: 'iphone-se', width: 375, height: 667, ratio: 2 },
  { name: 'ipad-pro-13', width: 1032, height: 1376, ratio: 2 },
  { name: 'ipad-pro-12-9', width: 1024, height: 1366, ratio: 2 },
  { name: 'ipad-pro-11', width: 834, height: 1194, ratio: 2 },
  { name: 'ipad-air', width: 820, height: 1180, ratio: 2 },
  { name: 'ipad-10-2', width: 810, height: 1080, ratio: 2 },
  { name: 'ipad-mini', width: 744, height: 1133, ratio: 2 },
] as const;

export const SPLASH_THEMES = ['light', 'dark'] as const;
export type SplashTheme = (typeof SPLASH_THEMES)[number];

export type SplashDevice = (typeof IOS_SPLASH_DEVICES)[number];

export function splashFile(device: SplashDevice, theme: SplashTheme): string {
  return `${device.name}-${theme}.png`;
}

/** `<link rel="apple-touch-startup-image">` tags for index.html. */
export function splashLinkTags(base = '/'): string {
  return IOS_SPLASH_DEVICES.flatMap((device) =>
    SPLASH_THEMES.map((theme) => {
      const media = [
        `(device-width: ${device.width}px)`,
        `(device-height: ${device.height}px)`,
        `(-webkit-device-pixel-ratio: ${device.ratio})`,
        '(orientation: portrait)',
        `(prefers-color-scheme: ${theme})`,
      ].join(' and ');
      return `<link rel="apple-touch-startup-image" media="screen and ${media}" href="${base}${SPLASH_DIR}/${splashFile(device, theme)}" />`;
    }),
  ).join('\n    ');
}
