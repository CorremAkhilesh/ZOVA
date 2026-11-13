import { type PushPayload, pushTagFor } from '@zuvo/protocol';
import { vi } from 'vitest';
import type { WindowLike, WorkerDeps } from './handlers';
import { swStrings } from './strings';

/** Test fixtures for the service worker's push modules. */
export const CHAT = '64b7f0c2a1b2c3d4e5f60001';
/** A VAPID public key of the right shape (65 bytes, 0x04 first), not a real one. */
export const KEY = `B${'A'.repeat(86)}`;

export const message = (overrides: Partial<Extract<PushPayload, { kind: 'message' }>> = {}) =>
  ({
    kind: 'message',
    v: 1,
    chatId: CHAT,
    tag: pushTagFor(CHAT),
    title: 'Asha Verma',
    body: 'See you at 5',
    seq: 42,
    count: 1,
    badge: 3,
    hidden: false,
    silent: false,
    sentAt: '2026-11-13T10:00:00.000Z',
    ...overrides,
  }) satisfies PushPayload;

export const ok = (body: unknown = {}) => new Response(JSON.stringify(body), { status: 200 });

export function fakeWindow(overrides: Partial<WindowLike> = {}): WindowLike {
  return {
    url: '/chats',
    focused: false,
    focus: vi.fn(async () => undefined),
    postMessage: vi.fn(),
    ...overrides,
  };
}

export function deps(overrides: Partial<WorkerDeps> = {}) {
  const shown: Array<{ title: string; options: NotificationOptions & Record<string, unknown> }> =
    [];
  const base: WorkerDeps = {
    fetch: vi.fn(async () => ok()),
    showNotification: vi.fn(async (title, options) => {
      shown.push({ title, options: options as NotificationOptions & Record<string, unknown> });
    }),
    notificationsWithTag: vi.fn(async () => []),
    badge: { setAppBadge: vi.fn(async () => {}), clearAppBadge: vi.fn(async () => {}) },
    windows: vi.fn(async () => []),
    openWindow: vi.fn(async () => null),
    strings: async () => swStrings('en'),
    capabilities: () => ({ maxActions: 2, canReply: true }),
    randomUUID: () => '0b0e6c1e-4a59-4a3c-9a1f-5d7f2e2c9a11',
    subscribe: vi.fn(),
  };
  return { deps: { ...base, ...overrides }, shown };
}

export const fetchCalls = (d: WorkerDeps) =>
  vi.mocked(d.fetch).mock.calls.map(([url, init]) => ({
    url,
    method: init.method,
    body: init.body ? JSON.parse(String(init.body)) : undefined,
    credentials: init.credentials,
  }));
