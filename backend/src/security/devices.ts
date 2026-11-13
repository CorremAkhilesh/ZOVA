import Bowser from 'bowser';

export interface DeviceInfo {
  browser: string;
  os: string;
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'unknown';
}

/** Browser, OS and device type from a User-Agent string. */
export function describeDevice(userAgent: string | null | undefined): DeviceInfo {
  if (!userAgent) return { browser: 'Unknown browser', os: 'Unknown OS', deviceType: 'unknown' };
  const parsed = Bowser.parse(userAgent);
  const browser = [parsed.browser.name, parsed.browser.version?.split('.')[0]]
    .filter(Boolean)
    .join(' ');
  const os = [parsed.os.name, parsed.os.versionName ?? parsed.os.version].filter(Boolean).join(' ');
  const platform = parsed.platform.type;
  const deviceType =
    platform === 'mobile' || platform === 'tablet' || platform === 'desktop' ? platform : 'unknown';
  return { browser: browser || 'Unknown browser', os: os || 'Unknown OS', deviceType };
}

/** Hides the host part: 103.201.140.••• or 2001:db8:85a3:•••. */
export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  const v4 = ip.replace(/^::ffff:/, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v4)) return `${v4.split('.').slice(0, 3).join('.')}.•••`;
  if (ip.includes(':')) return `${ip.split(':').slice(0, 3).join(':')}:•••`;
  return null;
}
