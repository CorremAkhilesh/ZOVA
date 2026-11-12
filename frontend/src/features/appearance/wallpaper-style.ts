import type { WALLPAPER_COLORS, WALLPAPER_PATTERNS, Wallpaper } from '@zuvo/protocol';
import type { CSSProperties } from 'react';
import { wallpaperImageUrl } from './api';
import type { ResolvedTheme } from './use-resolved-theme';

export type PatternId = (typeof WALLPAPER_PATTERNS)[number];
export type WallpaperColorId = (typeof WALLPAPER_COLORS)[number];

/** Calm, low-saturation backgrounds: bubbles and text keep their contrast on every one. */
export const WALLPAPER_COLOR_VALUES: Record<WallpaperColorId, Record<ResolvedTheme, string>> = {
  mist: { light: '#EEF1F8', dark: '#151A2E' },
  sand: { light: '#F4EEE6', dark: '#221D17' },
  sage: { light: '#E9EFEA', dark: '#18201B' },
  blush: { light: '#F8ECEF', dark: '#25171C' },
  sky: { light: '#E6F0FA', dark: '#0F1D2C' },
  slate: { light: '#E4E7ED', dark: '#1A1F2B' },
};

/** Drawn in the text color at a whisper, so a pattern never competes with the messages. */
const INK: Record<ResolvedTheme, { color: string; opacity: number }> = {
  light: { color: '#0F172A', opacity: 0.08 },
  dark: { color: '#E8EAF6', opacity: 0.07 },
};

const SHAPES: Record<Exclude<PatternId, 'none'>, { size: number; body: string }> = {
  dots: { size: 22, body: '<circle cx="11" cy="11" r="1.1" fill="C"/>' },
  grid: { size: 24, body: '<path d="M24 .5H.5V24" fill="none" stroke="C"/>' },
  waves: {
    size: 40,
    body: '<path d="M0 12q10-8 20 0t20 0M0 32q10-8 20 0t20 0" fill="none" stroke="C" stroke-width="1.2"/>',
  },
  leaves: {
    size: 48,
    body: '<path d="M8 30c0-9 7-16 16-16 0 9-7 16-16 16zM30 44c0-6 5-11 11-11 0 6-5 11-11 11z" fill="C"/>',
  },
  confetti: {
    size: 60,
    body: '<rect x="8" y="10" width="6" height="2" rx="1" transform="rotate(30 11 11)" fill="C"/><circle cx="40" cy="14" r="1.6" fill="C"/><rect x="28" y="40" width="6" height="2" rx="1" transform="rotate(-25 31 41)" fill="C"/><circle cx="12" cy="46" r="1.4" fill="C"/><rect x="48" y="30" width="2" height="6" rx="1" fill="C"/>',
  },
};

/** A tiling SVG for a pattern in this theme; null for "none". */
export function patternImage(id: PatternId, theme: ResolvedTheme): string | null {
  if (id === 'none') return null;
  const { size, body } = SHAPES[id];
  const ink = INK[theme];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><g opacity="${ink.opacity}">${body.replaceAll('"C"', `"${ink.color}"`)}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

const dimLayer = (dim: number) =>
  `linear-gradient(rgb(0 0 0 / ${dim / 100}), rgb(0 0 0 / ${dim / 100}))`;

/**
 * The CSS for a wallpaper. In the dark theme, colors and pictures are dimmed by `dim` % (patterns
 * already sit on the theme's own background). A picture that cannot load leaves the theme background.
 */
export function wallpaperStyle(
  wallpaper: Wallpaper,
  theme: ResolvedTheme,
  dim: number,
): CSSProperties {
  const dimmed = theme === 'dark' && dim > 0 ? [dimLayer(dim)] : [];
  if (wallpaper.kind === 'pattern') {
    const image = patternImage(wallpaper.id, theme);
    return {
      backgroundColor: 'var(--color-background)',
      backgroundImage: image ?? 'none',
    };
  }
  if (wallpaper.kind === 'color') {
    return {
      backgroundColor: WALLPAPER_COLOR_VALUES[wallpaper.id][theme],
      backgroundImage: dimmed.length ? dimmed.join(', ') : 'none',
    };
  }
  return {
    backgroundColor: 'var(--color-background)',
    backgroundImage: [...dimmed, `url("${wallpaperImageUrl(wallpaper.id)}")`].join(', '),
    backgroundSize: 'cover',
    backgroundPosition: 'center',
  };
}

/** Same wallpaper? (Chat override vs. default, picker selection.) */
export const sameWallpaper = (a: Wallpaper | null | undefined, b: Wallpaper | null | undefined) =>
  a?.kind === b?.kind && a?.id === b?.id;
