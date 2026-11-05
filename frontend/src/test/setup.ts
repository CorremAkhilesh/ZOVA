import '@testing-library/jest-dom/vitest';
import 'fake-indexeddb/auto';
import './socket-mock';
import { onlineManager } from '@tanstack/react-query';
import { cleanup } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import { useNewChat } from '@/features/chats/new-chat-store';
import { resetLiveStatus } from '@/features/sync/live-status';
import { wipeLocalDatabases } from '@/features/sync/local-db';
import { INITIAL_SYNC_STATE, useSyncStore } from '@/features/sync/store';
import { i18n, initI18n } from '@/lib/i18n';
import { axeMatchers } from './axe';
import { installMatchMedia, resetMedia } from './media';
import { server } from './msw';

expect.extend(axeMatchers);

// jsdom never finishes animation frames; complete Motion animations instantly in tests.
MotionGlobalConfig.skipAnimations = true;

// jsdom gaps used by the layout.
installMatchMedia();
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
Element.prototype.scrollIntoView ??= () => {};
// The message list only renders what fits its viewport, and jsdom says every box is empty.
// A very tall viewport keeps every row of a test's short chat in the page.
for (const [name, value] of [
  ['clientHeight', 100_000],
  ['clientWidth', 800],
] as const) {
  Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value });
}
window.scrollTo = () => {};
// jsdom has no object URLs; pictures never load in it anyway.
URL.createObjectURL ??= () => 'blob:test';
URL.revokeObjectURL ??= () => {};
// axe probes canvas for some checks; jsdom has none.
HTMLCanvasElement.prototype.getContext = () => null;

initI18n({ language: 'en' });

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(async () => {
  cleanup();
  useSyncStore.getState().client?.stop();
  useSyncStore.setState(INITIAL_SYNC_STATE);
  useNewChat.setState({ isOpen: false });
  resetLiveStatus();
  await wipeLocalDatabases();
  server.resetHandlers();
  // An `offline` event in one test must not pause queries in the next (global in TanStack Query).
  onlineManager.setOnline(true);
  resetMedia();
  installMatchMedia();
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  await i18n.changeLanguage('en');
});
afterAll(() => server.close());
