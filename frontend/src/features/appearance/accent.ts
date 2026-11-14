import { type AccentName, DEFAULT_ACCENT, isAccentName } from '@zuvo/ui-tokens';

/** localStorage key — also read by public/theme-init.js, so the first paint has the accent. */
export const ACCENT_STORAGE_KEY = 'zuvo-accent';

/** The accent this device used last. */
export function readStoredAccent(): AccentName {
  try {
    const value = localStorage.getItem(ACCENT_STORAGE_KEY);
    return isAccentName(value) ? value : DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}

/**
 * Puts the accent on <html data-accent>; tokens.css swaps every brand variable for it (light and dark),
 * live, without a reload. Also remembered on this device for the next first paint.
 */
export function applyAccent(accent: AccentName, root: HTMLElement = document.documentElement) {
  root.dataset.accent = accent;
  try {
    if (accent === DEFAULT_ACCENT) localStorage.removeItem(ACCENT_STORAGE_KEY);
    else localStorage.setItem(ACCENT_STORAGE_KEY, accent);
  } catch {
    // Storage blocked: the accent still applies, it just is not there before the next sign-in loads.
  }
}
