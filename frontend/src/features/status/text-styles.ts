import type { StatusBackground, StatusFont } from '@zuvo/protocol';

/**
 * How a text status looks: one deep colour per background (white text is AA on every one, see
 * text-styles.test.ts) with a soft gradient, and three letterings. The same in light and dark.
 */
export const BACKGROUND_COLORS: Record<StatusBackground, { from: string; to: string }> = {
  indigo: { from: '#4338CA', to: '#312E81' },
  teal: { from: '#0F766E', to: '#134E4A' },
  violet: { from: '#6D28D9', to: '#4C1D95' },
  rose: { from: '#BE123C', to: '#881337' },
  amber: { from: '#B45309', to: '#78350F' },
  sky: { from: '#0369A1', to: '#0C4A6E' },
  slate: { from: '#334155', to: '#0F172A' },
  emerald: { from: '#047857', to: '#064E3B' },
};

export const backgroundStyle = (background: StatusBackground) => {
  const { from, to } = BACKGROUND_COLORS[background];
  return { backgroundColor: from, backgroundImage: `linear-gradient(160deg, ${from}, ${to})` };
};

export const FONT_CLASSES: Record<StatusFont, string> = {
  sans: 'font-sans font-semibold',
  serif: 'font-serif italic',
  mono: 'font-mono',
};

/** Shorter texts are shown bigger. */
export function textSizeClass(text: string): string {
  if (text.length <= 40) return 'text-3xl md:text-4xl';
  if (text.length <= 140) return 'text-2xl md:text-3xl';
  return 'text-lg md:text-xl';
}
