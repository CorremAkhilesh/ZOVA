import { brand } from '@zuvo/config';
import { contrastRatio } from '@zuvo/ui-tokens';
import { describe, expect, it, vi } from 'vitest';
import { directDispatcher, queueDispatcher } from './dispatcher.ts';
import { createMemoryMailer, isMemoryMailer } from './memory-mailer.ts';
import { EMAIL_COLORS, EMAIL_CONTRAST_PAIRS, otpEmail } from './templates/otp-email.tsx';

describe('OTP email', () => {
  const expiresAt = new Date('2026-11-04T10:10:00.000Z'); // 15:40 IST

  it('has the agreed subject and both parts', async () => {
    const email = await otpEmail('asha@corremadvisory.com', '482913', expiresAt);
    expect(email.to).toBe('asha@corremadvisory.com');
    expect(email.subject).toBe(`482913 is your ${brand.name} verification code`);
    for (const part of [email.html, email.text]) {
      expect(part).toContain('482913');
      expect(part).toContain('10 minutes');
      expect(part).toMatch(/3:40\s?pm IST/i);
      expect(part).toContain('Only the most recent code works');
      expect(part).toContain('If you didn’t request this, ignore this email');
    }
  });

  it('declares light/dark support and Outlook dark-mode overrides', async () => {
    const { html } = await otpEmail('a@corremadvisory.com', '000111', expiresAt);
    expect(html).toContain('<meta name="color-scheme" content="light dark"/>');
    expect(html).toContain('<meta name="supported-color-schemes" content="light dark"/>');
    expect(html).toContain('prefers-color-scheme: dark');
    // New Outlook / Outlook.com recoloring: the code box is pinned to dark-on-light.
    expect(html).toContain(
      `[data-ogsb] .code { background-color: ${EMAIL_COLORS.light.codeBox} !important;`,
    );
    expect(html).toContain(
      `[data-ogsc] .code { color: ${EMAIL_COLORS.light.codeText} !important; }`,
    );
  });

  it('shows the code large, monospaced, and as one selectable string', async () => {
    const { html } = await otpEmail('a@corremadvisory.com', '482913', expiresAt);
    expect(html).toMatch(/class="code"[^>]*>482913<\/p>/);
    const style = /class="code" style="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(style).toMatch(/font-family:ui-monospace/);
    expect(style).toMatch(/font-size:36px/);
    expect(style).toMatch(/letter-spacing:0\.3em/);
    expect(html).toContain('user-select: all');
  });

  it.each(EMAIL_CONTRAST_PAIRS)('$scheme: $name meets 4.5:1', ({ fg, bg }) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('renders every text element with at least 4.5:1 against its background', async () => {
    const { html } = await otpEmail('a@corremadvisory.com', '482913', expiresAt);
    const { light } = EMAIL_COLORS;
    const backgroundFor: Record<string, string> = {
      text: light.card,
      secondary: light.card,
      'header-text': light.header,
    };
    const elements = [
      ...html.matchAll(/class="(code|text|secondary|header-text)" style="([^"]*)"/g),
    ];
    expect(elements.length).toBeGreaterThanOrEqual(6);
    for (const [, className = '', style = ''] of elements) {
      const color = /(?:^|;)color:(#[0-9A-Fa-f]{6})/.exec(style)?.[1];
      const background =
        /background-color:(#[0-9A-Fa-f]{6})/.exec(style)?.[1] ?? backgroundFor[className];
      expect(color, `${className} has an explicit color`).toBeDefined();
      expect(contrastRatio(color ?? '', background ?? '')).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('never puts the code in brand color on a brand-tinted box', async () => {
    const { html } = await otpEmail('a@corremadvisory.com', '482913', expiresAt);
    const style = /class="code" style="([^"]*)"/.exec(html)?.[1] ?? '';
    expect(style).not.toContain(brand.colors.primary);
    expect(contrastRatio(EMAIL_COLORS.light.codeText, EMAIL_COLORS.light.codeBox)).toBeGreaterThan(
      15,
    );
    expect(contrastRatio(EMAIL_COLORS.dark.codeText, EMAIL_COLORS.dark.codeBox)).toBeGreaterThan(
      12,
    );
  });
});

describe('email dispatchers', () => {
  const message = { to: 'a@x.com', subject: 's', html: 'h', text: 't' };

  it('queue dispatcher adds a named job', async () => {
    const add = vi.fn(async () => ({}) as never);
    await queueDispatcher({ add }).dispatch(message, 'otp');
    expect(add).toHaveBeenCalledWith('otp', message, {
      removeOnComplete: true,
      removeOnFail: { age: 3600 },
    });
    await queueDispatcher({ add }).dispatch(message, 'welcome');
    expect(add).toHaveBeenLastCalledWith('welcome', message, {});
  });

  it('direct dispatcher sends in the background and logs failures without the message', async () => {
    const mailer = createMemoryMailer();
    const logger = { error: vi.fn() };
    await directDispatcher(mailer, logger).dispatch(message, 'otp');
    await vi.waitFor(() => expect(mailer.lastTo('A@X.com')).toEqual(message));

    const failing = { ...mailer, send: vi.fn(async () => Promise.reject(new Error('smtp down'))) };
    await directDispatcher(failing, logger).dispatch(message, 'otp');
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain('"subject"');
  });

  it('memory mailer keeps an outbox that can be cleared', async () => {
    const mailer = createMemoryMailer();
    expect(isMemoryMailer(mailer)).toBe(true);
    await mailer.send(message);
    await mailer.verify();
    mailer.close();
    expect(mailer.outbox).toHaveLength(1);
    mailer.clear();
    expect(mailer.lastTo('a@x.com')).toBeUndefined();
  });
});
