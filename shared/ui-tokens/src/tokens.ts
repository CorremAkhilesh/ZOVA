import { type ColorTokens, darkColors, lightColors } from './colors.ts';
import { darkShadows, lightShadows, type ShadowTokens } from './shadows.ts';

export type { AccentKey, AccentName, AccentPreset, AccentTokens } from './accents.ts';
export { ACCENT_KEYS, ACCENT_NAMES, accents, DEFAULT_ACCENT, isAccentName } from './accents.ts';
export type { ColorName, ColorTokens } from './colors.ts';
export { darkColors, lightColors } from './colors.ts';
export { contrastRatio, relativeLuminance } from './contrast.ts';
export {
  duration,
  easing,
  fontFamily,
  fontSize,
  fontWeight,
  radius,
  spacing,
  zIndex,
} from './scales.ts';
export type { ShadowTokens } from './shadows.ts';
export { darkShadows, lightShadows } from './shadows.ts';

export type ThemeName = 'light' | 'dark';

export interface Theme {
  colors: ColorTokens;
  shadows: ShadowTokens;
}

export const themes = {
  light: { colors: lightColors, shadows: lightShadows },
  dark: { colors: darkColors, shadows: darkShadows },
} as const satisfies Record<ThemeName, Theme>;
