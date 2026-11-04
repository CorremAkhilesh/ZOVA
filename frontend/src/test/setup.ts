import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { MotionGlobalConfig } from 'motion/react';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';
import * as axeMatchers from 'vitest-axe/matchers';
import { i18n, initI18n } from '@/lib/i18n';
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
  resetMedia();
  installMatchMedia();
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  await i18n.changeLanguage('en');
});
afterAll(() => server.close());
