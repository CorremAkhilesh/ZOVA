import type { BrowserContext, CDPSession, Page } from '@playwright/test';

/** What the page counts about itself (see `installProbes`). */
export interface PageCounts {
  socketsOpened: number;
  socketsOpen: number;
  objectUrlsLive: number;
  objectUrlsCreated: number;
  audioElementsAlive: number;
  audioContextsOpen: number;
  intervalsLive: number;
}

declare global {
  interface Window {
    __perfCounts?: () => PageCounts;
    __perfIntervals?: () => Record<string, number>;
    __perfListeners?: () => Record<string, number>;
  }
}

/**
 * Counts what most often leaks: WebSockets, object URLs, <audio> elements (alive after a GC, via
 * FinalizationRegistry), AudioContexts that were never closed, and setIntervals never cleared.
 * Added before the app's scripts run.
 */
export async function installProbes(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    const counts = {
      socketsOpened: 0,
      socketsOpen: 0,
      objectUrlsCreated: 0,
      audioElementsAlive: 0,
      audioContextsOpen: 0,
    };
    const liveUrls = new Set<string>();
    /** Live setIntervals, by where they were started (a stack frame, for finding a leak). */
    const intervals = new Map<number, string>();

    const NativeSocket = window.WebSocket;
    class CountedSocket extends NativeSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        counts.socketsOpened += 1;
        counts.socketsOpen += 1;
        this.addEventListener('close', () => {
          counts.socketsOpen -= 1;
        });
      }
    }
    window.WebSocket = CountedSocket;

    const create = URL.createObjectURL.bind(URL);
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (object: Blob | MediaSource) => {
      const url = create(object);
      counts.objectUrlsCreated += 1;
      liveUrls.add(url);
      return url;
    };
    URL.revokeObjectURL = (url: string) => {
      liveUrls.delete(url);
      revoke(url);
    };

    const collected = new FinalizationRegistry<null>(() => {
      counts.audioElementsAlive -= 1;
    });
    const track = (element: HTMLAudioElement) => {
      counts.audioElementsAlive += 1;
      collected.register(element, null);
      return element;
    };
    const NativeAudio = window.Audio;
    window.Audio = function countedAudio(src?: string) {
      return track(new NativeAudio(src));
    } as unknown as typeof window.Audio;
    window.Audio.prototype = NativeAudio.prototype;
    const createElement = document.createElement.bind(document);
    document.createElement = ((tag: string, options?: ElementCreationOptions) => {
      const element = createElement(tag, options);
      return tag.toLowerCase() === 'audio' ? track(element as HTMLAudioElement) : element;
    }) as typeof document.createElement;

    if (window.AudioContext) {
      const NativeContext = window.AudioContext;
      class CountedContext extends NativeContext {
        constructor(options?: AudioContextOptions) {
          super(options);
          counts.audioContextsOpen += 1;
        }
        override close() {
          if (this.state !== 'closed') counts.audioContextsOpen -= 1;
          return super.close();
        }
      }
      window.AudioContext = CountedContext;
    }

    const setTimer = window.setInterval.bind(window);
    const clearTimer = window.clearInterval.bind(window);
    window.setInterval = ((handler: TimerHandler, ms?: number, ...rest: unknown[]) => {
      const handle = setTimer(handler, ms, ...rest);
      const caller = new Error().stack?.split('\n')[2]?.trim() ?? '?';
      intervals.set(
        handle,
        `${ms ?? 0}ms ${caller.replace(/^at /, '').replace(location.origin, '')}`,
      );
      return handle;
    }) as typeof window.setInterval;
    window.clearInterval = ((handle?: number) => {
      if (handle !== undefined) intervals.delete(handle);
      clearTimer(handle);
    }) as typeof window.clearInterval;
    // Timers share one pool of handles: clearTimeout stops an interval too.
    const clearTimeoutNative = window.clearTimeout.bind(window);
    window.clearTimeout = ((handle?: number) => {
      if (handle !== undefined) intervals.delete(handle);
      clearTimeoutNative(handle);
    }) as typeof window.clearTimeout;

    // Listeners added minus removed, by event, target and where they were added. A count that
    // grows from one snapshot to the next is a listener someone forgot to remove.
    const listeners = new Map<string, number>();
    const where = () =>
      (new Error().stack?.split('\n')[3]?.trim() ?? '?')
        .replace(/^at /, '')
        .replace(location.origin, '');
    /** Per target: listener → (type|capture → counting key), as the browser dedupes them. */
    const seen = new WeakMap<EventTarget, Map<unknown, Map<string, string>>>();
    // Elements and IndexedDB requests go away with their listeners; the CDP counts cover
    // elements. Counted here: long-lived targets (window, document, media queries, channels…).
    const shortLived = (target: EventTarget) =>
      target instanceof Node || target instanceof IDBTransaction || target instanceof IDBRequest;
    const slotOf = (type: string, options?: boolean | EventListenerOptions) =>
      `${type}|${typeof options === 'boolean' ? options : options?.capture === true}`;
    const nativeAdd = EventTarget.prototype.addEventListener;
    const nativeRemove = EventTarget.prototype.removeEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (listener && !shortLived(this)) {
        let byListener = seen.get(this);
        if (!byListener) {
          byListener = new Map();
          seen.set(this, byListener);
        }
        const slots = byListener.get(listener) ?? new Map<string, string>();
        byListener.set(listener, slots);
        const slot = slotOf(type, options);
        if (!slots.has(slot)) {
          const key = `${type} on ${this.constructor?.name ?? '?'} from ${where()}`;
          slots.set(slot, key);
          listeners.set(key, (listeners.get(key) ?? 0) + 1);
        }
      }
      return nativeAdd.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function (type, listener, options) {
      const slots = listener ? seen.get(this)?.get(listener) : undefined;
      const slot = slotOf(type, options);
      const key = slots?.get(slot);
      if (key !== undefined) {
        listeners.set(key, (listeners.get(key) ?? 1) - 1);
        slots?.delete(slot);
      }
      return nativeRemove.call(this, type, listener, options);
    };
    window.__perfListeners = () =>
      Object.fromEntries([...listeners].filter(([, count]) => count > 0));

    window.__perfCounts = () => ({
      ...counts,
      objectUrlsLive: liveUrls.size,
      intervalsLive: intervals.size,
    });
    window.__perfIntervals = () => {
      const bySource = new Map<string, number>();
      for (const source of intervals.values())
        bySource.set(source, (bySource.get(source) ?? 0) + 1);
      return Object.fromEntries([...bySource].sort((a, b) => b[1] - a[1]));
    };
  });
}

export interface Snapshot extends PageCounts {
  heapUsedMb: number;
  domNodes: number;
  jsEventListeners: number;
  documents: number;
  windowListeners: number;
  documentListeners: number;
}

const metric = (metrics: { name: string; value: number }[], name: string) =>
  metrics.find((entry) => entry.name === name)?.value ?? 0;

async function listenerCount(cdp: CDPSession, expression: string): Promise<number> {
  const { result } = await cdp.send('Runtime.evaluate', { expression });
  if (!result.objectId) return 0;
  const { listeners } = await cdp.send('DOMDebugger.getEventListeners', {
    objectId: result.objectId,
  });
  await cdp.send('Runtime.releaseObject', { objectId: result.objectId });
  return listeners.length;
}

/** Forces a full GC (twice, so FinalizationRegistry callbacks have run), then measures. */
export async function snapshot(page: Page, cdp: CDPSession): Promise<Snapshot> {
  for (let round = 0; round < 2; round++) {
    await cdp.send('HeapProfiler.collectGarbage');
    await page.waitForTimeout(300);
  }
  const { metrics } = await cdp.send('Performance.getMetrics');
  const counts = await page.evaluate(() => window.__perfCounts?.());
  if (!counts) throw new Error('Probes are not installed in this page');
  return {
    ...counts,
    heapUsedMb: Math.round((metric(metrics, 'JSHeapUsedSize') / 1024 / 1024) * 10) / 10,
    domNodes: metric(metrics, 'Nodes'),
    jsEventListeners: metric(metrics, 'JSEventListeners'),
    documents: metric(metrics, 'Documents'),
    windowListeners: await listenerCount(cdp, 'window'),
    documentListeners: await listenerCount(cdp, 'document'),
  };
}

export async function openCdp(page: Page): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('HeapProfiler.enable');
  return cdp;
}

export const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
};

export const percentile = (values: number[], p: number) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length * p)] ?? 0;
