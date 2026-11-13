import { DEFAULT_PUSH_SETTINGS, type PushDevice, type PushState } from '@zuvo/protocol';
import { vi } from 'vitest';
import { vapidKeyBytes } from '@/sw/push/vapid';
import { HttpResponse, http, server } from '@/test/msw';
import { usePushPrefs } from './prefs';

/** A real-looking VAPID public key (65 bytes, base64url). */
export const VAPID_KEY =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
export const ENDPOINT = 'https://push.example/sub-1';

interface BrowserOptions {
  permission?: NotificationPermission;
  /** What the permission prompt answers. */
  answer?: NotificationPermission;
  /** This browser already has a subscription (made with VAPID_KEY). */
  subscribed?: boolean;
  userAgent?: string;
}

/**
 * jsdom has no Notification, PushManager, service worker or badge: this fakes them all. Undo with
 * `restorePushBrowser()` (an afterEach does it).
 */
export function installPushBrowser(options: BrowserOptions = {}) {
  const subscription = {
    endpoint: ENDPOINT,
    options: { applicationServerKey: vapidKeyBytes(VAPID_KEY).buffer },
    toJSON: () => ({
      endpoint: ENDPOINT,
      expirationTime: null,
      keys: { p256dh: 'p256', auth: 'auth' },
    }),
    unsubscribe: vi.fn(async () => {
      current = null;
      return true;
    }),
  };
  let current: typeof subscription | null = options.subscribed ? subscription : null;
  const pushManager = {
    getSubscription: vi.fn(async () => current),
    subscribe: vi.fn(async () => {
      current = subscription;
      return subscription;
    }),
  };
  const shownNotifications: Array<{ close: () => void }> = [];
  const registration = {
    pushManager,
    getNotifications: vi.fn(async () => shownNotifications),
  };
  const container = Object.assign(new EventTarget(), {
    ready: Promise.resolve(registration),
    getRegistration: vi.fn(async () => registration),
  });
  const answer = options.answer ?? 'granted';
  const FakeNotification = {
    permission: options.permission ?? 'default',
    requestPermission: vi.fn(async () => {
      FakeNotification.permission = answer;
      return answer;
    }),
  };
  vi.stubGlobal('Notification', FakeNotification);
  vi.stubGlobal('PushManager', class {});
  const badge = { setAppBadge: vi.fn(async () => {}), clearAppBadge: vi.fn(async () => {}) };
  define(navigator, 'serviceWorker', container);
  define(navigator, 'setAppBadge', badge.setAppBadge);
  define(navigator, 'clearAppBadge', badge.clearAppBadge);
  if (options.userAgent) define(navigator, 'userAgent', options.userAgent);
  return {
    subscription,
    pushManager,
    registration,
    container,
    Notification: FakeNotification,
    badge,
    shownNotifications,
  };
}

const defined: Array<[object, string]> = [];
function define(target: object, key: string, value: unknown) {
  Object.defineProperty(target, key, { configurable: true, value });
  defined.push([target, key]);
}

export function restorePushBrowser() {
  vi.unstubAllGlobals();
  for (const [target, key] of defined.splice(0)) delete (target as Record<string, unknown>)[key];
  usePushPrefs.getState().reload();
}

export const deviceFixture = (overrides: Partial<PushDevice> = {}): PushDevice => ({
  id: 'd1',
  label: 'Chrome on Windows',
  current: true,
  createdAt: '2026-11-10T10:00:00.000Z',
  lastUsedAt: null,
  ...overrides,
});

/** GET/PUT/DELETE /v1/me/push… with state the test can read. */
export function servePush(initial: Partial<PushState> = {}) {
  const state = {
    push: {
      publicKey: VAPID_KEY,
      settings: DEFAULT_PUSH_SETTINGS,
      devices: [],
      ...initial,
    } as PushState,
    calls: [] as Array<{ method: string; path: string; body: unknown }>,
    testSent: 1,
  };
  const record = async (request: Request) => {
    const text = await request.text();
    state.calls.push({
      method: request.method,
      path: new URL(request.url).pathname,
      body: text ? JSON.parse(text) : undefined,
    });
  };
  server.use(
    http.get('*/v1/me/push', () => HttpResponse.json(state.push)),
    http.put('*/v1/me/push/subscription', async ({ request }) => {
      await record(request);
      const device = deviceFixture();
      state.push = {
        ...state.push,
        devices: [device, ...state.push.devices.filter((d) => !d.current)],
      };
      return HttpResponse.json({ device });
    }),
    http.delete('*/v1/me/push/subscription', async ({ request }) => {
      await record(request);
      return new HttpResponse(null, { status: 204 });
    }),
    http.delete('*/v1/me/push/devices/:id', async ({ request, params }) => {
      await record(request);
      state.push = { ...state.push, devices: state.push.devices.filter((d) => d.id !== params.id) };
      return new HttpResponse(null, { status: 204 });
    }),
    http.put('*/v1/me/push/settings', async ({ request }) => {
      await record(request);
      const changes = (state.calls.at(-1)?.body ?? {}) as Partial<PushState['settings']>;
      state.push = { ...state.push, settings: { ...state.push.settings, ...changes } };
      return HttpResponse.json({ settings: state.push.settings });
    }),
    http.post('*/v1/me/push/test', async ({ request }) => {
      await record(request);
      return HttpResponse.json({ sent: state.testSent });
    }),
  );
  return state;
}
