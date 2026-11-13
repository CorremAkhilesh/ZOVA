import { describe, expect, it } from 'vitest';
import { desktopBrowser, detectInstallGuide, installGuideOrder } from './install-order';

const UA = {
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  windowsEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0',
  macSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  linuxFirefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0',
  android:
    'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36',
  iphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
};

describe('install guide order', () => {
  it.each([
    ['Windows Chrome', UA.windowsChrome, 0, ['desktop', 'android', 'ios']],
    ['Mac Safari', UA.macSafari, 0, ['desktop', 'android', 'ios']],
    ['Linux Firefox', UA.linuxFirefox, 0, ['desktop', 'android', 'ios']],
    ['Android Chrome', UA.android, 5, ['android', 'desktop', 'ios']],
    ['iPhone Safari', UA.iphone, 5, ['ios', 'desktop', 'android']],
    ['iPad (Mac user agent + touch)', UA.macSafari, 5, ['ios', 'desktop', 'android']],
  ])('%s → this device first', (_name, userAgent, maxTouchPoints, expected) => {
    expect(installGuideOrder({ userAgent, maxTouchPoints })).toEqual(expected);
    expect(detectInstallGuide({ userAgent, maxTouchPoints })).toBe(expected[0]);
  });

  it.each([
    ['Chrome', UA.windowsChrome, 'chrome'],
    ['Edge', UA.windowsEdge, 'edge'],
    ['Firefox', UA.linuxFirefox, 'firefox'],
    ['Safari', UA.macSafari, 'safari'],
  ])('knows the computer browser: %s', (_name, userAgent, expected) => {
    expect(desktopBrowser({ userAgent })).toBe(expected);
  });
});
