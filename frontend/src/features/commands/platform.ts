interface NavigatorWithUaData {
  userAgentData?: { platform?: string };
  platform?: string;
}

/** True on macOS, iPhone and iPad, where the command key (⌘) takes Ctrl's place. */
export function isApplePlatform(nav: NavigatorWithUaData | undefined = globalThis.navigator) {
  try {
    const platform = nav?.userAgentData?.platform || nav?.platform || '';
    return /mac|iphone|ipad|ipod/i.test(platform);
  } catch {
    return false;
  }
}

/** "⌘" on Apple devices, else "Ctrl". */
export const modKeyLabel = (apple = isApplePlatform()) => (apple ? '⌘' : 'Ctrl');

/** Spells a shortcut written with "Mod" (Ctrl or ⌘) for this device: "Mod+K" → "Ctrl+K". */
export const formatKeys = (keys: string, apple = isApplePlatform()) =>
  keys.replace(/\bMod\b/g, modKeyLabel(apple));
