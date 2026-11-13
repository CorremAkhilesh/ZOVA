/** Paths the service worker must never serve from cache: API, realtime and media. */
export const NEVER_CACHE: readonly RegExp[] = [
  /^\/v1(\/|$)/,
  /^\/socket\.io(\/|$)/,
  /^\/media(\/|$)/,
];

export function isNeverCached(pathname: string): boolean {
  return NEVER_CACHE.some((pattern) => pattern.test(pathname));
}
