import { Writable } from 'node:stream';
import pino from 'pino';
import { describe, expect, it } from 'vitest';
import { loggerOptions, maskUrl } from '../lib/logger.ts';

/** A production logger writing JSON lines into memory. */
function capture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      lines.push(String(chunk));
      done();
    },
  });
  const logger = pino(loggerOptions({ NODE_ENV: 'production', LOG_LEVEL: 'info' }), stream);
  return { logger, text: () => lines.join('') };
}

const SECRETS = {
  otp: '482913',
  pin: '2468',
  currentPin: '1357',
  token: 'tok_live_secret_value',
  password: 'hunter2-password',
  pass: 'smtp-pass-value',
  secret: 'auth-secret-value-123',
  cookie: 'zuvo.session_token=abc123cookie',
  authorization: 'Bearer bearer-secret',
  keys: { p256dh: 'p256dh-key-value', auth: 'push-auth-value' },
  endpoint: 'https://push.example/send/endpoint-capability',
  AUTH_SECRET: 'env-auth-secret',
  VAPID_PRIVATE_KEY: 'vapid-private-value',
  SMTP_PASS: 'env-smtp-pass',
  MONGODB_URI: 'mongodb+srv://user:mongo-pass@cluster.example',
  REDIS_URL: 'redis://:redis-pass@127.0.0.1:6391',
};

describe('log redaction', () => {
  it('never writes secrets, at the top of a log object or one level down', () => {
    const { logger, text } = capture();
    logger.info(SECRETS, 'top level');
    logger.info({ body: SECRETS, env: SECRETS }, 'nested');
    logger.info(
      { req: { headers: { cookie: SECRETS.cookie, authorization: SECRETS.authorization } } },
      'headers',
    );
    const written = text();
    expect(written).toContain('top level');
    for (const value of [
      ...Object.values(SECRETS).filter((value) => typeof value === 'string'),
      SECRETS.keys.p256dh,
      SECRETS.keys.auth,
    ]) {
      expect(written).not.toContain(value);
    }
    expect(written).toContain('[redacted]');
  });

  it('masks credentials inside error messages and stacks', () => {
    const { logger, text } = capture();
    logger.error({ err: new Error('connect failed: redis://:redis-pass@10.0.0.5:6379') }, 'boom');
    expect(text()).not.toContain('redis-pass');
  });

  it('masks signed-link signatures, tokens and invite codes in logged request URLs', () => {
    expect(maskUrl('/v1/media/abc/content?exp=1&sig=SIGNATURE&download=1')).toBe(
      '/v1/media/abc/content?exp=1&sig=[redacted]&download=1',
    );
    expect(maskUrl('/v1/invites/AbCdEfGhIjKlMnOpQr/join')).toBe('/v1/invites/[redacted]/join');
    expect(maskUrl('/x?token=abc')).toBe('/x?token=[redacted]');
    const { logger, text } = capture();
    logger.info(
      { req: { method: 'GET', url: '/v1/media/a/content?sig=SECRETSIG', headers: {} } },
      'incoming request',
    );
    expect(text()).not.toContain('SECRETSIG');
  });
});
