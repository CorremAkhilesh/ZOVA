/** Chrome/Edge's install prompt event (not in the DOM typings yet). */
export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

type MatchMediaWindow = Pick<Window, 'matchMedia'> & {
  navigator: Navigator & { standalone?: boolean };
};

/** True when already running as an installed app (any platform). */
export function isStandalone(win: MatchMediaWindow = window): boolean {
  return (
    win.matchMedia('(display-mode: standalone)').matches ||
    win.matchMedia('(display-mode: window-controls-overlay)').matches ||
    win.navigator.standalone === true
  );
}

/**
 * iPhone / iPad Safari, where installing means Share → Add to Home Screen.
 * iPadOS reports a Mac user agent, so touch support tells them apart.
 * Chrome, Firefox and Edge on iOS identify themselves and are excluded.
 */
export function isIosSafari(
  nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> = navigator,
): boolean {
  const ua = nav.userAgent;
  const isIosDevice =
    /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && nav.maxTouchPoints > 1);
  const isOtherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);
  return isIosDevice && /WebKit/.test(ua) && !isOtherBrowser;
}
