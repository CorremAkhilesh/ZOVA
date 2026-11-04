import '@testing-library/jest-dom/vitest';
import { onlineManager } from '@tanstack/react-query';
import { cleanup } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
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
window.scrollTo = () => {};
// axe probes canvas for some checks; jsdom has none.
HTMLCanvasElement.prototype.getContext = () => null;

initI18n({ language: 'en' });

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(async () => {
  cleanup();
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
