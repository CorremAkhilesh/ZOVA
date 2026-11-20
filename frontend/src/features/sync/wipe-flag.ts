/**
 * A wipe that a blocked delete left unfinished is remembered here, in localStorage, so the app can
 * check for one on start without loading the local database's code (Dexie): the sign-in page
 * does not need it.
 */
export const PENDING_WIPE_KEY = 'zuvo-wipe-pending';

export function hasPendingWipe(): boolean {
  try {
    return localStorage.getItem(PENDING_WIPE_KEY) !== null;
  } catch {
    return false;
  }
}
