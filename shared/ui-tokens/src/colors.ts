import { brand } from '@zuvo/config';

/** Light theme colors. Every theme must define exactly these keys. */
export const lightColors = {
  // Brand (deep indigo)
  brand: brand.colors.primary,
  brandHover: '#4338CA',
  brandForeground: '#FFFFFF',
  brandSubtle: '#EEF2FF',
  brandText: '#4338CA',

  // Accent (teal) — darker than the brand accent so white text stays readable
  accent: '#0F766E',
  accentHover: '#115E59',
  accentForeground: '#FFFFFF',
  accentSubtle: '#CCFBF1',
  accentText: '#0F766E',

  // Neutrals
  background: '#F5F6FA',
  surface: '#FFFFFF',
  elevated: '#FFFFFF',
  border: '#E2E5EE',
  borderStrong: '#C9CEDB',
  text: '#0F172A',
  textMuted: '#5B6476',
  textInverse: '#FFFFFF',

  // Status
  success: '#15803D',
  warning: '#B45309',
  danger: '#DC2626',
  info: '#0369A1',

  // Chat bubbles
  bubbleOutgoing: '#4F46E5',
  bubbleOutgoingText: '#FFFFFF',
  bubbleOutgoingMeta: '#E0E7FF',
  bubbleOutgoingRead: '#99F6E4',
  bubbleIncoming: '#FFFFFF',
  bubbleIncomingText: '#0F172A',
  bubbleIncomingMeta: '#5B6476',
} as const;

export type ColorName = keyof typeof lightColors;
export type ColorTokens = Record<ColorName, string>;

export const darkColors = {
  brand: brand.colors.primary,
  brandHover: '#4338CA',
  brandForeground: '#FFFFFF',
  brandSubtle: '#1E1B4B',
  brandText: '#A5B4FC',

  // Accent uses the bright brand teal with dark text on top
  accent: brand.colors.accent,
  accentHover: '#2DD4BF',
  accentForeground: '#042F2E',
  accentSubtle: '#134E4A',
  accentText: '#5EEAD4',

  background: '#0B0D17',
  surface: '#12152A',
  elevated: '#1A1E36',
  border: '#2A2F4A',
  borderStrong: '#3B4163',
  text: '#E8EAF6',
  textMuted: '#9AA3C0',
  textInverse: '#0F172A',

  success: '#4ADE80',
  warning: '#FBBF24',
  danger: '#F87171',
  info: '#38BDF8',

  bubbleOutgoing: '#3730A3',
  bubbleOutgoingText: '#FFFFFF',
  bubbleOutgoingMeta: '#C7D2FE',
  bubbleOutgoingRead: '#5EEAD4',
  bubbleIncoming: '#1A1E36',
  bubbleIncomingText: '#E8EAF6',
  bubbleIncomingMeta: '#9AA3C0',
} as const satisfies ColorTokens;
