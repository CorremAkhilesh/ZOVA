import { brand } from '@zuvo/config';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { testEnvSource } from '../../test/helpers.ts';
import { loadEnv } from '../config/env.ts';

const { transport, createTransport } = vi.hoisted(() => {
  const fake = {
    sendMail: vi.fn(async () => ({ messageId: '<id@corremadvisory.com>' })),
    verify: vi.fn(async () => true),
    close: vi.fn(),
  };
  return { transport: fake, createTransport: vi.fn((_options: unknown) => fake) };
});
vi.mock('nodemailer', () => ({ createTransport }));

const { createMailer } = await import('./mailer.ts');
const { testEmail } = await import('./templates/test-email.ts');

const env = loadEnv(testEnvSource());

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createMailer', () => {
  it('uses a pooled, authenticated SMTP transport from env', () => {
    createMailer(env);
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        pool: true,
        host: 'smtp.example.test',
        port: 465,
        secure: true,
        auth: { user: 'nova@corremadvisory.com', pass: 'test-password' },
      }),
    );
  });

  it('sends From "<brand sender name> <MAIL_FROM>"', async () => {
    const mailer = createMailer(env);
    const message = { to: 'a@corremadvisory.com', subject: 'Hi', html: '<p>Hi</p>', text: 'Hi' };
    await expect(mailer.send(message)).resolves.toEqual({ messageId: '<id@corremadvisory.com>' });
    expect(transport.sendMail).toHaveBeenCalledWith({
      from: { name: brand.email.senderName, address: 'nova@corremadvisory.com' },
      ...message,
    });
  });

  it('verifies and closes the transport', async () => {
    const mailer = createMailer(env);
    await mailer.verify();
    mailer.close();
    expect(transport.verify).toHaveBeenCalledOnce();
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it('propagates SMTP failures', async () => {
    transport.sendMail.mockRejectedValueOnce(new Error('535 auth failed'));
    const mailer = createMailer(env);
    await expect(
      mailer.send({ to: 'a@corremadvisory.com', subject: 's', html: 'h', text: 't' }),
    ).rejects.toThrow('535');
  });
});

describe('testEmail template', () => {
  it('is branded and includes the environment and time', () => {
    const sentAt = new Date('2026-11-04T10:00:00.000Z');
    const email = testEmail('akhilesh@corremadvisory.com', 'development', sentAt);
    expect(email.to).toBe('akhilesh@corremadvisory.com');
    expect(email.subject).toBe(`${brand.name} test email`);
    for (const body of [email.text, email.html]) {
      expect(body).toContain(brand.name);
      expect(body).toContain('development');
      expect(body).toContain(sentAt.toISOString());
    }
    expect(email.html).toContain(brand.colors.primary);
  });
});
