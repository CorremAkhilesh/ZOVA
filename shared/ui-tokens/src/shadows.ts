/** Shadows differ per theme: dark surfaces need stronger, darker shadows. */

export const lightShadows = {
  sm: '0 1px 2px rgb(15 23 42 / 0.06)',
  md: '0 4px 12px rgb(15 23 42 / 0.08)',
  lg: '0 12px 32px rgb(15 23 42 / 0.12)',
} as const;

export type ShadowTokens = Record<keyof typeof lightShadows, string>;

export const darkShadows = {
  sm: '0 1px 2px rgb(0 0 0 / 0.4)',
  md: '0 4px 12px rgb(0 0 0 / 0.5)',
  lg: '0 12px 32px rgb(0 0 0 / 0.6)',
} as const satisfies ShadowTokens;
