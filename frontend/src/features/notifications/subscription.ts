import type { PushDevice } from '@zuvo/protocol';
import { sameKey, vapidKeyBytes } from '@/sw/push/vapid';
import { pushApi } from './api';

/** The service worker registers on load; without one (dev server, blocked) there is no push. */
export const WORKER_WAIT_MS = 10_000;

export class NoServiceWorkerError extends Error {
  constructor() {
    super('No service worker: push needs the installed or built app.');
    this.name = 'NoServiceWorkerError';
  }
}

async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  const container = navigator.serviceWorker;
  if (!container) throw new NoServiceWorkerError();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      container.ready,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new NoServiceWorkerError()), WORKER_WAIT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

let inFlight: { key: string; promise: Promise<PushDevice> } | null = null;

async function subscribe(publicKey: string): Promise<PushDevice> {
  const { pushManager } = await readyRegistration();
  let subscription = await pushManager.getSubscription();
  // Made with another server key: the push service would refuse our messages.
  if (subscription && !sameKey(subscription.options.applicationServerKey, publicKey)) {
    await subscription.unsubscribe().catch(() => false);
    subscription = null;
  }
  subscription ??= await pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: vapidKeyBytes(publicKey),
  });
  // Idempotent on the server: sent on every start too, so it always knows the current endpoint.
  return (await pushApi.subscribe(subscription.toJSON())).device;
}

/**
 * Subscribes this browser (or reuses its subscription) and tells the server. Calls that overlap
 * share one attempt.
 */
export function subscribeThisDevice(publicKey: string): Promise<PushDevice> {
  if (inFlight?.key === publicKey) return inFlight.promise;
  const promise = subscribe(publicKey).finally(() => {
    if (inFlight?.promise === promise) inFlight = null;
  });
  inFlight = { key: publicKey, promise };
  return promise;
}

/**
 * Stops push on this browser: tells the server first (while still signed in), then drops the
 * browser's subscription. Best effort, never throws: sign-out must go on regardless.
 */
/** Signing out never waits longer than this on the browser's push service. */
export const UNSUBSCRIBE_WAIT_MS = 3_000;

export async function unsubscribeThisDevice(options: { tellServer: boolean }): Promise<void> {
  // A browser subscription needs the permission: without it there is nothing to stop, so signing
  // out does not wait at all. (The server drops the session's subscription with the session.)
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Some browsers never answer getRegistration/getSubscription (WebKit without a worker): give up.
  const gaveUp = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, UNSUBSCRIBE_WAIT_MS);
  });
  try {
    await Promise.race([stopPush(options), gaveUp]);
  } finally {
    clearTimeout(timer);
  }
}

async function stopPush(options: { tellServer: boolean }): Promise<void> {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    const subscription = await registration?.pushManager?.getSubscription();
    if (!subscription) return;
    if (options.tellServer) await pushApi.unsubscribe(subscription.endpoint).catch(() => undefined);
    await subscription.unsubscribe();
  } catch {
    // No worker or no push here: nothing to stop.
  }
}
