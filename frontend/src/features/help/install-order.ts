import { isIosDevice } from '@/features/notifications/support';

/** The install guides, in their default order. */
export const INSTALL_GUIDES = ['desktop', 'android', 'ios'] as const;
export type InstallGuide = (typeof INSTALL_GUIDES)[number];

type Nav = Pick<Navigator, 'userAgent' | 'maxTouchPoints'>;

/** Which guide fits this device: iPhone/iPad (also iPadOS's Mac user agent), Android, or a computer. */
export function detectInstallGuide(nav: Nav = navigator): InstallGuide {
  if (isIosDevice(nav)) return 'ios';
  if (/Android/i.test(nav.userAgent)) return 'android';
  return 'desktop';
}

/** This device's guide first, then the others in their usual order. */
export function installGuideOrder(nav: Nav = navigator): InstallGuide[] {
  const mine = detectInstallGuide(nav);
  return [mine, ...INSTALL_GUIDES.filter((guide) => guide !== mine)];
}

export type DesktopBrowser = 'edge' | 'chrome' | 'firefox' | 'safari';

/** On a computer, which browser's steps to show first. */
export function desktopBrowser(nav: Pick<Navigator, 'userAgent'> = navigator): DesktopBrowser {
  const ua = nav.userAgent;
  if (/Edg\//.test(ua)) return 'edge';
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Safari\//.test(ua) && !/Chrom(e|ium)\//.test(ua)) return 'safari';
  return 'chrome';
}
