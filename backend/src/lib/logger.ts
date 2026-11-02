import { type LoggerOptions, stdSerializers } from 'pino';
import type { Env } from '../config/env.ts';

const CENSOR = '[redacted]';

/** Log paths that may carry secrets. Values at these paths are never written to logs. */
export const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  '*.password',
  '*.pass',
  '*.otp',
  '*.token',
  '*.secret',
  '*.uri',
  '*.connectionString',
  '*.MONGODB_URI',
  '*.REDIS_URL',
  '*.SMTP_PASS',
];

const CREDENTIALS_IN_URL = /([a-z][a-z0-9+.-]*:\/\/)[^@/\s]+@/gi;

/** Removes `user:password@` from any URL inside a string, e.g. in a driver error message. */
export function maskCredentials(text: string): string {
  return text.replace(CREDENTIALS_IN_URL, `$1${CENSOR}@`);
}

export function loggerOptions(env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>): LoggerOptions {
  const options: LoggerOptions = {
    level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
    redact: { paths: REDACT_PATHS, censor: CENSOR },
    serializers: {
      err: (error: Error) => {
        const serialized = stdSerializers.err(error);
        serialized.message = maskCredentials(serialized.message);
        serialized.stack = maskCredentials(serialized.stack);
        return serialized;
      },
    },
    hooks: {
      logMethod(args, method) {
        const masked = args.map((arg) => (typeof arg === 'string' ? maskCredentials(arg) : arg));
        method.apply(this, masked as Parameters<typeof method>);
      },
    },
  };
  if (env.NODE_ENV === 'development') {
    options.transport = {
      target: 'pino-pretty',
      options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
    };
  }
  return options;
}
