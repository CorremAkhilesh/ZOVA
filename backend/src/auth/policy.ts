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
