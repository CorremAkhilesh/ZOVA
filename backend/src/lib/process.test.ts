import { Writable } from 'node:stream';
import { pino } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppError, codeForStatus } from './errors.ts';
import { loggerOptions } from './logger.ts';
import { handleShutdown } from './shutdown.ts';

describe('errors', () => {
  it.each([
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [409, 'CONFLICT'],
    [413, 'PAYLOAD_TOO_LARGE'],
    [429, 'RATE_LIMITED'],
    [503, 'SERVICE_UNAVAILABLE'],
    [418, 'BAD_REQUEST'],
    [500, 'INTERNAL_ERROR'],
    [502, 'INTERNAL_ERROR'],
  ])('maps HTTP %i to %s', (status, code) => {
    expect(codeForStatus(status)).toBe(code);
  });

  it('gives each AppError code its HTTP status', () => {
    expect(new AppError('EMAIL_DOMAIN_NOT_ALLOWED', 'nope').statusCode).toBe(403);
    expect(new AppError('OTP_ATTEMPTS_EXCEEDED', 'slow down').statusCode).toBe(429);
  });
});

describe('loggerOptions', () => {
  function capture(env: Parameters<typeof loggerOptions>[0]) {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    });
    const options = loggerOptions(env);
    // The pretty transport replaces the stream; drop it to inspect raw JSON.
    const { transport: _transport, ...rest } = options;
    return { logger: pino(rest, stream), lines, options };
  }

  it('is silent in tests and pretty in development', () => {
    expect(loggerOptions({ NODE_ENV: 'test', LOG_LEVEL: 'info' }).level).toBe('silent');
    expect(loggerOptions({ NODE_ENV: 'development', LOG_LEVEL: 'debug' }).transport).toMatchObject({
      target: 'pino-pretty',
    });
    expect(loggerOptions({ NODE_ENV: 'production', LOG_LEVEL: 'info' }).transport).toBeUndefined();
  });

  it('redacts secrets, cookies and credentials in URLs', () => {
    const { logger, lines } = capture({ NODE_ENV: 'production', LOG_LEVEL: 'info' });
    logger.info(
      {
        req: { headers: { cookie: 'session=abc', authorization: 'Bearer xyz' } },
        user: { otp: '123456' },
      },
      'connecting to mongodb+srv://admin:hunter2@cluster.example.net',
    );
    logger.error({ err: new Error('failed: rediss://default:s3cret@redis.example.com') }, 'boom');
    const output = lines.join('\n');
    for (const secret of ['session=abc', 'Bearer xyz', '123456', 'hunter2', 's3cret']) {
      expect(output).not.toContain(secret);
    }
    expect(output).toContain('[redacted]');
  });
});

describe('handleShutdown', () => {
  const signals = ['SIGTERM', 'SIGINT', 'unhandledRejection', 'uncaughtException'] as const;
  const before = new Map(signals.map((name) => [name, process.listeners(name as 'SIGTERM')]));

  afterEach(() => {
    // Remove only the listeners this test added.
    for (const name of signals) {
      const keep = before.get(name) ?? [];
      for (const listener of process.listeners(name as 'SIGTERM')) {
        if (!keep.includes(listener)) process.removeListener(name, listener);
      }
    }
    vi.restoreAllMocks();
  });

  const logger = { info: vi.fn(), error: vi.fn(), fatal: vi.fn() };

  it('closes once on SIGTERM and exits 0', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const close = vi.fn(async () => {});
    handleShutdown(logger, close);
    process.emit('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(close).toHaveBeenCalledOnce();
  });

  it('forces exit 1 on a second signal or when closing fails', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    handleShutdown(logger, async () => {
      throw new Error('close failed');
    });
    process.emit('SIGINT');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    process.emit('SIGINT');
    expect(logger.error).toHaveBeenCalledWith('second shutdown signal: forcing exit');
  });

  it('forces exit 1 when closing takes too long', async () => {
    vi.useFakeTimers();
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    handleShutdown(logger, () => new Promise(() => {}), 1000);
    process.emit('SIGTERM');
    await vi.advanceTimersByTimeAsync(1001);
    expect(exit).toHaveBeenCalledWith(1);
    vi.useRealTimers();
  });
});
