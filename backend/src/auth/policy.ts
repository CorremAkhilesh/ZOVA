import { emailDomainNotAllowedMessage, isAllowedEmail, normalizeEmail } from '@zuvo/protocol';
import { APIError } from 'better-auth/api';

/** Who may sign in: organization emails only, never deactivated accounts. */
export interface AccessPolicy {
  allowedDomains: readonly string[];
  adminEmails: readonly string[];
}

export const DEACTIVATED_MESSAGE = 'This account has been deactivated. Contact your administrator.';

export function domainRejected(policy: AccessPolicy): APIError {
  return new APIError('FORBIDDEN', {
    code: 'EMAIL_DOMAIN_NOT_ALLOWED',
    message: emailDomainNotAllowedMessage(policy.allowedDomains),
  });
}

export function accountDeactivated(): APIError {
  return new APIError('FORBIDDEN', { code: 'ACCOUNT_DEACTIVATED', message: DEACTIVATED_MESSAGE });
}

interface Suspendable {
  suspendedUntil?: Date | string | null;
  suspendReason?: string | null;
}

/** An admin's suspension still running at `now`, or null (none, or it has ended on its own). */
export function suspensionOf(user: Suspendable | null | undefined, now = new Date()) {
  if (!user?.suspendedUntil) return null;
  const until = new Date(user.suspendedUntil);
  if (Number.isNaN(until.getTime()) || until <= now) return null;
  return { until, reason: user.suspendReason ?? '' };
}

/** 403 with the date and the admin's reason, so the sign-in screen can say both. */
export function accountSuspended(suspension: { until: Date; reason: string }): APIError {
  return new APIError('FORBIDDEN', {
    code: 'ACCOUNT_SUSPENDED',
    message: `This account is suspended until ${suspension.until.toISOString()}.`,
    until: suspension.until.toISOString(),
    reason: suspension.reason,
  });
}

/** Throws the 403 for non-organization emails. Uses the one shared rule from @zuvo/protocol. */
export function assertAllowedEmail(email: unknown, policy: AccessPolicy): string {
  if (typeof email !== 'string' || !isAllowedEmail(email, policy.allowedDomains)) {
    throw domainRejected(policy);
  }
  return normalizeEmail(email);
}

export function isAdminEmail(email: string, policy: AccessPolicy): boolean {
  return policy.adminEmails.includes(normalizeEmail(email));
}
