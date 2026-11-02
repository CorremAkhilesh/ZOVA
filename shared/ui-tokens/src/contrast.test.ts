import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast.ts';
import { type ColorName, type ColorTokens, themes } from './tokens.ts';

/** WCAG 2.x AA minimum for normal-size text. */
const AA_NORMAL_TEXT = 4.5;

/** Every text color paired with each background it is meant to sit on. */
const TEXT_PAIRS: Array<[text: ColorName, background: ColorName]> = [
  ['text', 'background'],
  ['text', 'surface'],
  ['text', 'elevated'],
  ['textMuted', 'background'],
  ['textMuted', 'surface'],
  ['textMuted', 'elevated'],
  ['brandText', 'surface'],
  ['brandText', 'background'],
  ['accentText', 'surface'],
  ['brandForeground', 'brand'],
  ['brandForeground', 'brandHover'],
  ['accentForeground', 'accent'],
  ['accentForeground', 'accentHover'],
  ['textInverse', 'text'],
  ['success', 'surface'],
  ['warning', 'surface'],
  ['danger', 'surface'],
  ['info', 'surface'],
  ['bubbleOutgoingText', 'bubbleOutgoing'],
  ['bubbleOutgoingMeta', 'bubbleOutgoing'],
  ['bubbleIncomingText', 'bubbleIncoming'],
  ['bubbleIncomingMeta', 'bubbleIncoming'],
];

function pairCases(colors: ColorTokens) {
  return TEXT_PAIRS.map(([text, background]) => ({
    text,
    background,
    ratio: contrastRatio(colors[text], colors[background]),
  }));
}

describe('contrastRatio', () => {
  it('returns 21 for black on white and 1 for identical colors', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#4F46E5', '#4f46e5')).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#0F172A', '#F5F6FA')).toBe(contrastRatio('#F5F6FA', '#0F172A'));
  });

  it('rejects colors that are not 6-digit hex', () => {
    expect(() => contrastRatio('#fff', '#000000')).toThrow();
  });
});

describe.each(Object.entries(themes))('%s theme meets WCAG AA', (_name, theme) => {
  it.each(pairCases(theme.colors))('$text on $background ($ratio)', ({ ratio }) => {
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });
});
