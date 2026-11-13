/**
 * The app's language, kept where the service worker can read it (it has no localStorage). A cache
 * outside the `zuvo-` prefix, so the worker's cleanup of old versions never removes it.
 */
export const PREFS_CACHE = 'zuvo:prefs';
const LANGUAGE_URL = '/__prefs/language';

/** The app saves its language whenever it changes. Best effort: English is the fallback. */
export async function saveLanguageForWorker(language: string): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(PREFS_CACHE);
    await cache.put(LANGUAGE_URL, new Response(language));
  } catch {
    // Storage blocked: notifications fall back to the browser's language.
  }
}

/** What the app saved, else the browser's own language. */
export async function workerLanguage(fallback: string): Promise<string> {
  if (typeof caches === 'undefined') return fallback;
  try {
    const cache = await caches.open(PREFS_CACHE);
    const saved = await cache.match(LANGUAGE_URL);
    return saved ? await saved.text() : fallback;
  } catch {
    return fallback;
  }
}
