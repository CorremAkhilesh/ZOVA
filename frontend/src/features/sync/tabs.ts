export type TabMessage = 'outbox-changed' | 'session-ended';

const CHANNEL = 'zuvo-tabs';

/** Tells the other tabs of this browser. Dexie already keeps their screens up to date. */
export function openTabChannel(onMessage: (message: TabMessage) => void) {
  if (typeof BroadcastChannel === 'undefined') {
    return { post: (_message: TabMessage) => undefined, close: () => undefined };
  }
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event: MessageEvent<TabMessage>) => onMessage(event.data);
  return {
    post: (message: TabMessage) => channel.postMessage(message),
    close: () => channel.close(),
  };
}

/** Says the session has ended, for code that has no open channel of its own. */
export function announceSessionEnded(): void {
  const { post, close } = openTabChannel(() => undefined);
  post('session-ended');
  close();
}

/**
 * Exactly one tab at a time sends the outbox. The browser hands the lock to the next tab when the
 * holder closes. Where Web Locks are missing, every tab sends and the server's clientMsgId check
 * still prevents duplicates.
 */
export function watchLeadership(name: string, onLeader: () => void) {
  const controller = new AbortController();
  if (!navigator.locks) {
    onLeader();
    return { stop: () => undefined };
  }
  navigator.locks
    .request(name, { signal: controller.signal }, () => {
      onLeader();
      // Held until this tab closes or stops.
      return new Promise<void>((resolve) => {
        controller.signal.addEventListener('abort', () => resolve());
      });
    })
    .catch(() => undefined);
  return { stop: () => controller.abort() };
}
