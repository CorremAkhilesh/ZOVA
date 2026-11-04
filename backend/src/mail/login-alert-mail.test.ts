import { describe, expect, it } from 'vitest';
import { formatIst } from './templates/email-layout.tsx';
import { loginAlertEmail } from './templates/login-alert-email.tsx';

const props = {
  device: { browser: 'Firefox 140', os: 'Windows 11', deviceType: 'desktop' as const },
  // 09:30 UTC = 15:00 IST
  signedInAt: new Date('2026-11-04T09:30:00Z'),
  notMeUrl: 'https://app.example.test/security/not-me#token=abc_DEF-123',
};

describe('new-login alert email', () => {
  it('names the device, browser, OS and the time in IST', async () => {
    const message = await loginAlertEmail('asha@corremadvisory.com', props);
    expect(message.subject).toBe('New sign-in to your Zuvo account');
    expect(message.text).toContain('Device: desktop');
    expect(message.text).toContain('Browser: Firefox 140');
    expect(message.text).toContain('Operating system: Windows 11');
    expect(message.text).toMatch(/Time: 4 Nov 2026,? 3:00\s?pm IST/i);
    expect(message.text).toContain(props.notMeUrl);
  });

  it('renders the "This wasn’t me" button with the fragment link and dark-mode styles', async () => {
    const { html } = await loginAlertEmail('asha@corremadvisory.com', props);
    expect(html).toContain('href="https://app.example.test/security/not-me#token=abc_DEF-123"');
    expect(html).toContain('This wasn’t me');
    expect(html).toContain('prefers-color-scheme: dark');
    expect(html).toContain('[data-ogsb] .button');
  });

  it('formats times in India time with or without the date', () => {
    expect(formatIst(props.signedInAt)).toMatch(/^3:00\s?pm IST$/i);
    expect(formatIst(props.signedInAt, true)).toMatch(/2026/);
  });
});
