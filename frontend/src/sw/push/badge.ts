/** The App Badging API, where the browser has it (installed PWAs on Chrome, Edge and Safari). */
export interface BadgeNavigator {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

/** Shows `count` on the app icon, or clears it at 0. Never throws: unsupported means nothing. */
export async function applyAppBadge(nav: BadgeNavigator, count: number): Promise<void> {
  try {
    if (count > 0) await nav.setAppBadge?.(count);
    else await nav.clearAppBadge?.();
  } catch {
    // Not installed, not allowed, or not supported: the badge is a nicety.
  }
}
