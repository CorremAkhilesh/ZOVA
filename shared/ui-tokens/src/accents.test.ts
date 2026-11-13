import { describe, expect, it } from 'vitest';
import { ACCENT_KEYS, ACCENT_NAMES, type AccentKey, accents, isAccentName } from './accents.ts';
import { contrastRatio } from './contrast.ts';
import { generateTokensCss } from './css.ts';
import { type ColorName, themes } from './tokens.ts';

const AA_NORMAL_TEXT = 4.5;

/** Text on the color it sits on: accent tokens on accent tokens, or on the theme's surfaces. */
const PAIRS: Array<[text: AccentKey | ColorName, background: AccentKey | ColorName]> = [
  ['brandForeground', 'brand'],
  ['brandForeground', 'brandHover'],
  ['brandText', 'surface'],
  ['brandText', 'background'],
  ['brandText', 'elevated'],
  ['brandText', 'brandSubtle'],
  // A selected chat row and the active nav item sit on brandSubtle.
  ['text', 'brandSubtle'],
  ['textMuted', 'brandSubtle'],
  ['bubbleOutgoingText', 'bubbleOutgoing'],
  ['bubbleOutgoingMeta', 'bubbleOutgoing'],
  ['bubbleOutgoingRead', 'bubbleOutgoing'],
];

const cases = ACCENT_NAMES.flatMap((accent) =>
  (['light', 'dark'] as const).flatMap((theme) => {
    const colors = { ...themes[theme].colors, ...accents[accent][theme] };
    return PAIRS.map(([text, background]) => ({
      accent,
      theme,
      text,
      background,
      ratio: contrastRatio(colors[text], colors[background]),
    }));
  }),
);

describe('accent presets', () => {
  it.each(cases)('$accent ($theme): $text on $background ($ratio)', ({ ratio }) => {
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  // WCAG 1.4.11: focus rings (brandText, see globals.css) stand out from every page background.
  const AA_NON_TEXT = 3;
  const rings = ACCENT_NAMES.flatMap((accent) =>
    (['light', 'dark'] as const).flatMap((theme) => {
      const colors = { ...themes[theme].colors, ...accents[accent][theme] };
      return (['background', 'surface', 'elevated'] as const).map((background) => ({
        accent,
        theme,
        background,
        ratio: contrastRatio(colors.brandText, colors[background]),
      }));
    }),
  );
  it.each(rings)('$accent ($theme): focus ring on $background ($ratio)', ({ ratio }) => {
    expect(ratio).toBeGreaterThanOrEqual(AA_NON_TEXT);
  });

  it('keeps indigo #4F46E5 as the default brand', () => {
    expect(accents.indigo.light.brand).toBe('#4F46E5');
    expect(accents.indigo.dark).toEqual(
      Object.fromEntries(ACCENT_KEYS.map((key) => [key, themes.dark.colors[key]])),
    );
  });

  it('defines every key for every preset, as 6-digit hex', () => {
    for (const name of ACCENT_NAMES) {
      for (const theme of ['light', 'dark'] as const) {
        expect(Object.keys(accents[name][theme]).sort()).toEqual([...ACCENT_KEYS].sort());
        for (const value of Object.values(accents[name][theme])) {
          expect(value).toMatch(/^#[0-9A-F]{6}$/);
        }
      }
    }
  });

  it('recognises accent names', () => {
    expect(isAccentName('teal')).toBe(true);
    expect(isAccentName('green')).toBe(false);
    expect(isAccentName(3)).toBe(false);
  });

  it('emits light and dark overrides for every accent but the default', () => {
    const css = generateTokensCss();
    expect(css).toContain('[data-accent="teal"] {');
    expect(css).toContain('[data-theme="dark"][data-accent="teal"] {');
    expect(css).not.toContain('[data-accent="indigo"]');
    const rose = css.slice(css.indexOf('[data-theme="dark"][data-accent="rose"]'));
    expect(rose).toContain(`--color-brand-text: ${accents.rose.dark.brandText};`);
  });
});
