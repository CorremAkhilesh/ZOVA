import type { TFunction } from 'i18next';
import { authErrorMessage, errorCode } from '@/features/auth/errors';
import { ApiClientError } from '@/lib/api-client';

export interface PinFailure {
  /** Shown under the PIN pad; null while locked out (the countdown says it). */
  message: string | null;
  /** Too many wrong PINs: no more tries until then. */
  lockedUntil: string | null;
}

function details(error: unknown): Record<string, unknown> {
  const raw = error instanceof ApiClientError ? error.apiError?.details : undefined;
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

/** A wrong PIN, a lockout, or anything else, in the current language. */
export function pinFailure(error: unknown, t: TFunction): PinFailure {
  const code = errorCode(error);
  const info = details(error);
  if (code === 'PIN_LOCKED_OUT' && typeof info.lockedUntil === 'string') {
    return { message: null, lockedUntil: info.lockedUntil };
  }
  if (code === 'PIN_INVALID') {
    const left = typeof info.attemptsLeft === 'number' ? info.attemptsLeft : 0;
    return { message: t('lock.wrongPin', { count: left }), lockedUntil: null };
  }
  return { message: lockErrorMessage(error, t), lockedUntil: null };
}

/** Any lock request's error, in the current language. */
export function lockErrorMessage(error: unknown, t: TFunction): string {
  const code = errorCode(error);
  if (code === 'PIN_NOT_SET') return t('lock.noPin');
  if (code === 'PIN_INVALID') return t('lock.wrongPin', { count: 0 });
  if (code === 'PIN_LOCKED_OUT') return t('lock.lockedOut');
  return authErrorMessage(error, t);
}
