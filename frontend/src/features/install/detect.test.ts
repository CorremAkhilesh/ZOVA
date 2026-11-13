import { describe, expect, it } from 'vitest';
import { isIosSafari, isStandalone } from './detect';

const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1',
  ipadOsSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  android:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
};

describe('isIosSafari', () => {
  it.each([
    ['iPhone Safari', UA.iphoneSafari, 5, true],
    ['iPadOS Safari (desktop UA + touch)', UA.ipadOsSafari, 5, true],
    ['Mac Safari (no touch)', UA.ipadOsSafari, 0, false],
    ['iPhone Chrome', UA.iphoneChrome, 5, false],
    ['Windows Chrome', UA.windowsChrome, 0, false],
    ['Android Chrome', UA.android, 5, false],
  ])('%s → %s', (_name, userAgent, maxTouchPoints, expected) => {
    expect(isIosSafari({ userAgent, maxTouchPoints })).toBe(expected);
  });
});

describe('isStandalone', () => {
  const fakeWindow = (modes: string[], standalone?: boolean) => ({
    matchMedia: (query: string) =>
      ({ matches: modes.some((mode) => query.includes(mode)) }) as MediaQueryList,
    navigator: { standalone } as Navigator & { standalone?: boolean },
  });

  it('is false in a normal browser tab', () => {
    expect(isStandalone(fakeWindow([]))).toBe(false);
  });

  it.each([
    ['display-mode: standalone', fakeWindow(['standalone'])],
    ['window-controls-overlay', fakeWindow(['window-controls-overlay'])],
    ['iOS navigator.standalone', fakeWindow([], true)],
  ])('is true for %s', (_name, win) => {
    expect(isStandalone(win)).toBe(true);
  });
});
