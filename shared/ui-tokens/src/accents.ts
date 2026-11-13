import { type ColorName, darkColors, lightColors } from './colors.ts';

/** The accent presets a person can pick (same ids as the protocol's accentSchema). Indigo is the brand default. */
export const ACCENT_NAMES = ['indigo', 'teal', 'violet', 'rose', 'amber', 'sky'] as const;
export type AccentName = (typeof ACCENT_NAMES)[number];

/** The color tokens an accent replaces: everything the brand color drives. */
export const ACCENT_KEYS = [
  'brand',
  'brandHover',
  'brandForeground',
  'brandSubtle',
  'brandText',
  'bubbleOutgoing',
  'bubbleOutgoingText',
  'bubbleOutgoingMeta',
  'bubbleOutgoingRead',
] as const satisfies readonly ColorName[];
export type AccentKey = (typeof ACCENT_KEYS)[number];
export type AccentTokens = Record<AccentKey, string>;

export interface AccentPreset {
  /** What the picker shows for this accent. */
  swatch: string;
  light: AccentTokens;
  dark: AccentTokens;
}

const pick = (colors: Record<ColorName, string>): AccentTokens =>
  Object.fromEntries(ACCENT_KEYS.map((key) => [key, colors[key]])) as AccentTokens;

/** Every pair is AA (4.5:1) in both themes — see accents.test.ts. Never a WhatsApp green. */
export const accents: Record<AccentName, AccentPreset> = {
  indigo: { swatch: lightColors.brand, light: pick(lightColors), dark: pick(darkColors) },
  teal: {
    swatch: '#0F766E',
    light: {
      brand: '#0F766E',
      brandHover: '#115E59',
      brandForeground: '#FFFFFF',
      brandSubtle: '#CCFBF1',
      brandText: '#0F766E',
      bubbleOutgoing: '#115E59',
      bubbleOutgoingText: '#FFFFFF',
      bubbleOutgoingMeta: '#CCFBF1',
      bubbleOutgoingRead: '#FDE68A',
    },
    dark: {
      brand: '#0F766E',
      brandHover: '#115E59',
      brandForeground: '#FFFFFF',
      brandSubtle: '#134E4A',
      brandText: '#5EEAD4',
      bubbleOutgoing: '#115E59',
      bubbleOutgoingText: '#FFFFFF',
      bubbleOutgoingMeta: '#CCFBF1',
      bubbleOutgoingRead: '#FDE68A',
    },
  },
  violet: {
    swatch: '#7C3AED',
    light: {
      brand: '#7C3AED',
      brandHover: '#6D28D9',
      brandForeground: '#FFFFFF',
      brandSubtle: '#F5F3FF',
      brandText: '#6D28D9',
      bubbleOutgoing: '#6D28D9',
      bubbleOutgoingText: '#FFFFFF',
      bubbleOutgoingMeta: '#EDE9FE',
      bubbleOutgoingRead: '#99F6E4',
    },
    dark: {
      brand: '#7C3AED',
      brandHover: '#6D28D9',
      brandForeground: '#FFFFFF',
      brandSubtle: '#2E1065',
      brandText: '#C4B5FD',
      bubbleOutgoing: '#5B21B6',
      bubbleOutgoingText: '#FFFFFF',
      bubbleOutgoingMeta: '#DDD6FE',
      bubbleOutgoingRead: '#5EEAD4',
    },
  },
  rose: {
    swatch: '#E11D48',
    light: {
      brand: '#E11D48',
      brandHover: '#BE123C',
      brandForeground: '#FFFFFF',
      brandSubtle: '#FFF1F2',
      brandText: '#BE123C',
      bubbleOutgoing: '#BE123C',
      bubbleOutgoingText: '#FFFFFF',
      bubbleOutgoingMeta: '#FFE4E6',
      bubbleOutgoingRead: '#99F6E4',
    },
    dark: {
      brand: '#BE123C',
      brandHover: '#9F1239',
      brandForeground: '#FFFFFF',
      brandSubtle: '#4C0519',
      brandText: '#FDA4AF',
      bubbleOutgoing: '#9F1239',
      bubbleOutgoingText: '#FFFFFF',
      bubbleOutgoingMeta: '#FECDD3',
      bubbleOutgoingRead: '#5EEAD4',
    },
  },
  amber: {
    swatch: '#D97706',
    light: {
      brand: '#B45309',
      brandHover: '#92400E',
      brandForeground: '#FFFFFF',
      brandSubtle: '#FEF3C7',
      brandText: '#92400E',
      bubbleOutgoing: '#92400E',
      bubbleOutgoingText: '#FFFFFF',
      bubbleOutgoingMeta: '#FEF3C7',
      bubbleOutgoingRead: '#99F6E4',
    },
    dark: {
      brand: '#FBBF24',
      brandHover: '#F59E0B',
      brandForeground: '#451A03',
      brandSubtle: '#451A03',
      brandText: '#FCD34D',
      bubbleOutgoing: '#78350F',
      bubbleOutgoingText: '#FFFFFF',
      bubbleOutgoingMeta: '#FDE68A',
      bubbleOutgoingRead: '#5EEAD4',
    },
  },
  sky: {
    swatch: '#0284C7',
    light: {
      brand: '#0369A1',
      brandHover: '#075985',
      brandForeground: '#FFFFFF',
      brandSubtle: '#E0F2FE',
      brandText: '#0369A1',
      bubbleOutgoing: '#075985',
      bubbleOutgoingText: '#FFFFFF',
      bubbleOutgoingMeta: '#E0F2FE',
      bubbleOutgoingRead: '#FDE68A',
    },
    dark: {
      brand: '#0369A1',
      brandHover: '#075985',
      brandForeground: '#FFFFFF',
      brandSubtle: '#082F49',
      brandText: '#7DD3FC',
      bubbleOutgoing: '#075985',
      bubbleOutgoingText: '#FFFFFF',
      bubbleOutgoingMeta: '#BAE6FD',
      bubbleOutgoingRead: '#5EEAD4',
    },
  },
};

export const DEFAULT_ACCENT: AccentName = 'indigo';

export const isAccentName = (value: unknown): value is AccentName =>
  typeof value === 'string' && (ACCENT_NAMES as readonly string[]).includes(value);
