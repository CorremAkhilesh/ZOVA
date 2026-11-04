import { describe, expect, it } from 'vitest';
import { describeDevice, maskIp } from './devices.ts';

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';

describe('describeDevice', () => {
  it('reads browser, OS and device type from the user agent', () => {
    expect(describeDevice(CHROME_WINDOWS)).toEqual({
      browser: 'Chrome 141',
      os: 'Windows 10',
      deviceType: 'desktop',
    });
    expect(describeDevice(SAFARI_IPHONE)).toMatchObject({
      browser: 'Safari 18',
      deviceType: 'mobile',
    });
    expect(describeDevice(SAFARI_IPHONE).os).toMatch(/^iOS/);
  });

  it('falls back to "unknown" without a user agent', () => {
    expect(describeDevice(null)).toEqual({
      browser: 'Unknown browser',
      os: 'Unknown OS',
      deviceType: 'unknown',
    });
    expect(describeDevice('curl/8.0').deviceType).toBe('unknown');
  });
});

describe('maskIp', () => {
  it('hides the host part of IPv4, IPv4-mapped and IPv6 addresses', () => {
    expect(maskIp('103.201.140.17')).toBe('103.201.140.•••');
    expect(maskIp('::ffff:10.0.0.9')).toBe('10.0.0.•••');
    expect(maskIp('2001:db8:85a3:0:0:8a2e:370:7334')).toBe('2001:db8:85a3:•••');
  });

  it('returns null for missing or unrecognised values', () => {
    expect(maskIp(null)).toBeNull();
    expect(maskIp('')).toBeNull();
    expect(maskIp('not-an-ip')).toBeNull();
  });
});
