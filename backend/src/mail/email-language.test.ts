import { brand } from '@zuvo/config';
import { describe, expect, it } from 'vitest';
import { languageFromHeader } from './templates/email-strings.ts';
import { lockResetEmail } from './templates/lock-reset-email.tsx';
import { loginAlertEmail } from './templates/login-alert-email.tsx';
import { otpEmail } from './templates/otp-email.tsx';

const expiresAt = new Date('2026-11-04T10:10:00.000Z'); // 15:40 IST
const DEVANAGARI = /[ऀ-ॿ]/;

describe('emails in Hindi', () => {
  it('OTP: subject, body and footer in Hindi, with the code and brand', async () => {
    const email = await otpEmail('asha@corremadvisory.com', '482913', expiresAt, 'hi');
    expect(email.subject).toBe(`482913 आपका ${brand.name} OTP है`);
    for (const part of [email.html, email.text]) {
      expect(part).toContain('482913');
      expect(part).toContain('10 मिनट');
      expect(part).toContain('IST');
      expect(part).toContain('केवल सबसे नया OTP ही काम करता है');
      expect(part).toContain(brand.taglineHi);
      expect(part).not.toContain('verification code');
    }
    expect(email.html).toContain('lang="hi"');
  });

  it('new-login alert: Hindi labels, button and the same single-use link', async () => {
    const notMeUrl = 'https://app.example.test/security/not-me#token=abc';
    const email = await loginAlertEmail('asha@corremadvisory.com', {
      device: { browser: 'Firefox 140', os: 'Windows 11', deviceType: 'desktop' },
      signedInAt: new Date('2026-11-04T09:30:00Z'),
      notMeUrl,
      language: 'hi',
    });
    expect(email.subject).toBe(`आपके ${brand.name} खाते में नया साइन-इन`);
    expect(email.text).toContain('डिवाइस: कंप्यूटर');
    expect(email.text).toContain('ब्राउज़र: Firefox 140');
    expect(email.text).toContain('ऑपरेटिंग सिस्टम: Windows 11');
    expect(email.text).toMatch(/समय: .*2026.* IST/);
    expect(email.text).toContain(notMeUrl);
    expect(email.html).toContain('यह मैं नहीं था');
    expect(email.html).not.toContain('This wasn’t me');
  });

  it('PIN reset: subject and body in Hindi, keeping "PIN"', async () => {
    const email = await lockResetEmail('asha@corremadvisory.com', {
      code: '123456',
      expiresAt,
      minutes: 10,
      language: 'hi',
    });
    expect(email.subject).toBe(`123456 आपका ${brand.name} PIN रीसेट कोड है`);
    expect(email.text).toContain('आपका PIN जैसा है वैसा ही रहेगा');
    expect(email.html).toContain('अपना PIN रीसेट करें');
    expect(email.html).toMatch(DEVANAGARI);
  });

  it('English stays the default', async () => {
    const email = await otpEmail('asha@corremadvisory.com', '482913', expiresAt);
    expect(email.subject).toBe(`482913 is your ${brand.name} verification code`);
    expect(email.text).not.toMatch(DEVANAGARI);
    expect(email.html).toContain('lang="en"');
  });
});

describe('languageFromHeader', () => {
  it('is Hindi only when Hindi comes first', () => {
    expect(languageFromHeader('hi')).toBe('hi');
    expect(languageFromHeader('hi-IN,en;q=0.8')).toBe('hi');
    expect(languageFromHeader('en-US,hi;q=0.9')).toBe('en');
    expect(languageFromHeader('history')).toBe('en');
    expect(languageFromHeader(undefined)).toBe('en');
    expect(languageFromHeader('')).toBe('en');
  });
});
