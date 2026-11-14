import { type LoggerOptions, stdSerializers } from 'pino';
import type { Env } from '../config/env.ts';

const CENSOR = '[redacted]';

/**
 * Keys that may carry secrets, redacted both at the top of a log object and one level down.
 * PINs, push subscription keys and VAPID/auth secrets included; never logged on purpose.
 */
const SECRET_KEYS = [
  'password',
  'pass',
  'otp',
  'pin',
  'currentPin',
  // Email content can contain one-time codes.
  'subject',
  'html',
  'text',
  'token',
  'secret',
  'uri',
  'connectionString',
  'cookie',
  'authorization',
  // Web Push: a subscription's keys (p256dh + auth) and its capability URL.
  'keys',
  'p256dh',
  'endpoint',
  'MONGODB_URI',
  'REDIS_URL',
  'SMTP_PASS',
  'AUTH_SECRET',
  'VAPID_PRIVATE_KEY',
];

/** Log paths that may carry secrets. Values at these paths are never written to logs. */
export const REDACT_PATHS = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'res.headers["set-cookie"]',
  ...SECRET_KEYS,
  ...SECRET_KEYS.map((name) => `*.${name}`),
];

/** Query parameters that are bearer secrets: signed media links and single-use tokens. */
const SECRET_QUERY = /([?&](?:sig|token|code)=)[^&#]*/gi;

/** Group invite codes travel in the path and let anyone join. */
const INVITE_CODE = /(\/invites\/)[^/?#]+/g;

/** A request URL as it may be logged: secret query values and invite codes masked. */
export function maskUrl(url: string): string {
  return url.replace(SECRET_QUERY, `$1${CENSOR}`).replace(INVITE_CODE, `$1${CENSOR}`);
}

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
      req: (request: { method?: string; url?: string; host?: string; ip?: string }) => ({
        method: request.method,
        url: maskUrl(request.url ?? ''),
        host: request.host,
        remoteAddress: request.ip,
      }),
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
