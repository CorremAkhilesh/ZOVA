/// <reference lib="webworker" />
/**
 * Service worker (vite-plugin-pwa, injectManifest).
 * - Precaches the hashed app shell; old precaches are cleaned up on activate.
 * - Navigations: network first (with navigation preload), falling back to the cached shell,
 *   then to offline.html.
 * - Never touches the API, sockets or media: nothing under /v1, /socket.io or /media is cached,
 *   and there is no runtime caching of API data.
 */
import { clientsClaim, setCacheNameDetails } from 'workbox-core';
import { enable as enableNavigationPreload } from 'workbox-navigation-preload';
import { cleanupOutdatedCaches, matchPrecache, precacheAndRoute } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { NEVER_CACHE } from './never-cache';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

/** Bump to force a clean cache on every client (cache names include it). */
const CACHE_VERSION = 'v1';
const CACHE_PREFIX = 'zuvo';
const NAVIGATION_TIMEOUT_MS = 4000;

setCacheNameDetails({ prefix: CACHE_PREFIX, suffix: CACHE_VERSION });

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
enableNavigationPreload();

async function fromNetwork(event: FetchEvent): Promise<Response> {
  const preload = (await event.preloadResponse) as Response | undefined;
  if (preload) return preload;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), NAVIGATION_TIMEOUT_MS);
  try {
    return await fetch(event.request, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

registerRoute(
  new NavigationRoute(
    async ({ event }) => {
      try {
        return await fromNetwork(event as FetchEvent);
      } catch {
        return (
          (await matchPrecache('/index.html')) ??
          (await matchPrecache('/offline.html')) ??
          Response.error()
        );
      }
    },
    { denylist: [...NEVER_CACHE] },
  ),
);

// Remove caches from older Zuvo versions (anything ours that is not the current version).
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter(
              (name) => name.startsWith(`${CACHE_PREFIX}-`) && !name.endsWith(`-${CACHE_VERSION}`),
            )
            .map((name) => caches.delete(name)),
        ),
      ),
  );
});

// The page asks the waiting worker to take over when the user clicks "Reload".
self.addEventListener('message', (event) => {
  if ((event.data as { type?: string } | null)?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
});

clientsClaim();
