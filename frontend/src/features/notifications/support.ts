import { useSyncExternalStore } from 'react';
import { isStandalone } from '@/features/install/detect';

/**
 * Can this browser get Web Push?
 * - supported: service worker + PushManager + Notification
 * - ios-install: iPhone / iPad outside the installed app (push only works from the Home Screen icon)
 * - unsupported: anything else
 */
export type PushSupport = 'supported' | 'ios-install' | 'unsupported';
export type PermissionState = NotificationPermission | 'unsupported';
/** Which "how to unblock" steps fit this browser. */
export type BrowserFamily = 'chromium' | 'firefox' | 'safari-mac' | 'ios';

export function isIosDevice(nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> = navigator) {
  const ua = nav.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Macintosh') && nav.maxTouchPoints > 1);
}

export function pushSupport(win: Window = window): PushSupport {
  const hasPush = 'serviceWorker' in win.navigator && 'PushManager' in win && 'Notification' in win;
  if (isIosDevice(win.navigator) && !isStandalone(win)) return 'ios-install';
  return hasPush ? 'supported' : 'unsupported';
}

export function browserFamily(nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> = navigator) {
  const ua = nav.userAgent;
  if (isIosDevice(nav)) return 'ios' satisfies BrowserFamily;
  if (/Firefox\//.test(ua)) return 'firefox' satisfies BrowserFamily;
  if (/Safari\//.test(ua) && !/Chrom(e|ium)\/|Edg\//.test(ua)) {
    return 'safari-mac' satisfies BrowserFamily;
  }
  return 'chromium' satisfies BrowserFamily;
}

export function readPermission(): PermissionState {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

/** Re-checked when the tab comes back: the permission may have changed in the browser's settings. */
function subscribe(onChange: () => void) {
  window.addEventListener('focus', onChange);
  document.addEventListener('visibilitychange', onChange);
  permissionListeners.add(onChange);
  return () => {
    window.removeEventListener('focus', onChange);
    document.removeEventListener('visibilitychange', onChange);
    permissionListeners.delete(onChange);
  };
}
const permissionListeners = new Set<() => void>();

/** Tell every screen the permission changed (after asking for it). */
export function permissionChanged() {
  for (const listener of permissionListeners) listener();
}

/** The notification permission, kept current. */
export function usePermission(): PermissionState {
  return useSyncExternalStore(subscribe, readPermission, () => 'default');
}
