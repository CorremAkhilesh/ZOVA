import type { ErrorCode } from '@zuvo/protocol';
import { isAPIError } from 'better-auth/api';
import { AppError } from '../lib/errors.ts';

const KNOWN_CODES = new Set<ErrorCode>([
  'EMAIL_DOMAIN_NOT_ALLOWED',
  'ACCOUNT_DEACTIVATED',
  'RATE_LIMITED',
  'BAD_REQUEST',
  'UNAUTHENTICATED',
]);

interface AuthErrorBody {
  code?: string;
  message?: string;
  retryAfterSeconds?: number;
}

/** Maps a Better Auth error body (thrown APIError or JSON Response) to our AppError. */
export function authErrorFromBody(status: number, body: AuthErrorBody): AppError {
  const message = body.message ?? 'Something went wrong. Please try again.';
  if (body.code === 'RATE_LIMITED' || status === 429) {
    return new AppError('RATE_LIMITED', message, {
      retryAfterSeconds: body.retryAfterSeconds ?? 60,
    });
  }
  if (body.code === 'OTP_EXPIRED')
    return new AppError('OTP_EXPIRED', 'This code has expired. Request a new one.');
  if (body.code === 'TOO_MANY_ATTEMPTS') {
    return new AppError('OTP_ATTEMPTS_EXCEEDED', 'Too many wrong codes. Request a new one.', {
      attemptsRemaining: 0,
    });
  }
  if (body.code && KNOWN_CODES.has(body.code as ErrorCode)) {
    return new AppError(body.code as ErrorCode, message);
  }
  if (status === 403) return new AppError('FORBIDDEN', message);
  if (status === 401) return new AppError('UNAUTHENTICATED', message);
  if (status >= 400 && status < 500) return new AppError('BAD_REQUEST', message);
  return new AppError('INTERNAL_ERROR', 'Something went wrong. Please try again.');
}

/** Converts Better Auth's thrown APIError; rethrows anything else unchanged. */
export function rethrowAuthError(error: unknown): never {
  if (isAPIError(error)) {
    throw authErrorFromBody(error.statusCode, (error.body ?? {}) as AuthErrorBody);
  }
  throw error;
}
