import { brand } from '@zuvo/config';
import { lightColors } from '@zuvo/ui-tokens';
import { describe, expect, it, vi } from 'vitest';
import { directDispatcher, queueDispatcher } from './dispatcher.ts';
import { createMemoryMailer, isMemoryMailer } from './memory-mailer.ts';
import { otpEmail } from './templates/otp-email.tsx';

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
      expect(part).toContain('If you didn’t request this, ignore this email');
    }
  });

  it('is branded and dark-mode aware', async () => {
    const { html } = await otpEmail('a@corremadvisory.com', '000111', expiresAt);
    expect(html).toContain(brand.name);
    expect(html).toContain(brand.colors.primary);
    expect(html).toContain(lightColors.brandText);
    expect(html).toContain('prefers-color-scheme: dark');
    expect(html).toContain('name="color-scheme"');
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
