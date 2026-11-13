import type { TFunction } from 'i18next';
import { ApiClientError } from '@/lib/api-client';

/** "45 seconds", "3 minutes", "1 hour" — for rate-limit messages. */
export function formatWait(seconds: number, t: TFunction): string {
  if (seconds < 60) return t('auth.wait.seconds', { count: Math.max(1, Math.ceil(seconds)) });
  if (seconds < 3600) return t('auth.wait.minutes', { count: Math.ceil(seconds / 60) });
  return t('auth.wait.hours', { count: Math.ceil(seconds / 3600) });
}

/** Human message for an auth API error, in the current language. */
export function authErrorMessage(error: unknown, t: TFunction): string {
  if (!(error instanceof ApiClientError)) return t('auth.errors.generic');
  if (error.isNetworkError) return t('auth.errors.network');
  const details = error.apiError?.details as
    | { retryAfterSeconds?: number; attemptsRemaining?: number }
    | undefined;
  switch (error.apiError?.code) {
    case 'RATE_LIMITED':
      return t('auth.errors.rateLimited', {
        wait: formatWait(details?.retryAfterSeconds ?? 60, t),
      });
    case 'EMAIL_DOMAIN_NOT_ALLOWED':
      return t('auth.errors.domain');
    case 'ACCOUNT_DEACTIVATED':
      return t('auth.errors.deactivated');
    case 'OTP_INVALID':
      return t('auth.errors.wrongCode', { count: details?.attemptsRemaining ?? 0 });
    case 'OTP_ATTEMPTS_EXCEEDED':
      return t('auth.errors.tooManyAttempts');
    case 'OTP_EXPIRED':
      return t('auth.errors.expired');
    case 'VALIDATION_FAILED':
      return t('auth.errors.invalid');
    default:
      return error.apiError?.message ?? t('auth.errors.generic');
  }
}

export function errorCode(error: unknown): string | undefined {
  return error instanceof ApiClientError ? error.apiError?.code : undefined;
}
