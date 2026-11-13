/** Theme-independent scales: radius, spacing, typography, motion and z-index. */

export const radius = {
  none: '0',
  sm: '0.375rem',
  md: '0.625rem',
  lg: '0.875rem',
  xl: '1.25rem',
  full: '9999px',
} as const;

export const spacing = {
  '0': '0',
  '0.5': '0.125rem',
  '1': '0.25rem',
  '1.5': '0.375rem',
  '2': '0.5rem',
  '3': '0.75rem',
  '4': '1rem',
  '5': '1.25rem',
  '6': '1.5rem',
  '8': '2rem',
  '10': '2.5rem',
  '12': '3rem',
  '16': '4rem',
} as const;

/** Self-hosted variable fonts first (Fontsource family names), then system fallbacks. */
export const fontFamily = {
  sans: '"Inter Variable", "Inter", "Noto Sans Devanagari Variable", "Noto Sans Devanagari", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  devanagari:
    '"Noto Sans Devanagari Variable", "Noto Sans Devanagari", "Inter Variable", system-ui, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, "Cascadia Code", Consolas, monospace',
} as const;

/** Font sizes with their matching line heights. */
export const fontSize = {
  xs: { size: '0.75rem', lineHeight: '1rem' },
  sm: { size: '0.875rem', lineHeight: '1.25rem' },
  base: { size: '1rem', lineHeight: '1.5rem' },
  lg: { size: '1.125rem', lineHeight: '1.75rem' },
  xl: { size: '1.25rem', lineHeight: '1.75rem' },
  '2xl': { size: '1.5rem', lineHeight: '2rem' },
  '3xl': { size: '1.875rem', lineHeight: '2.25rem' },
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export const duration = {
  instant: '80ms',
  fast: '150ms',
  base: '220ms',
  slow: '320ms',
} as const;

export const easing = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  emphasized: 'cubic-bezier(0.3, 0, 0, 1.2)',
  exit: 'cubic-bezier(0.4, 0, 1, 1)',
} as const;

export const zIndex = {
  base: '0',
  dropdown: '1000',
  sticky: '1100',
  overlay: '1200',
  modal: '1300',
  popover: '1400',
  toast: '1500',
  tooltip: '1600',
} as const;
