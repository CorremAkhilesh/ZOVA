import { brand } from '@zuvo/config';
import { z } from 'zod';

/** RFC 5321 maximum length of an email address. */
const EMAIL_MAX_LENGTH = 254;

/**
 * Pragmatic email format: one "@", no whitespace, a dot-atom local part and a domain of
 * dot-separated labels (letters, digits, inner hyphens) with at least one dot.
 * Applied to already-normalized (lowercase) input.
 */
const EMAIL_PATTERN =
  /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export const DEFAULT_ALLOWED_EMAIL_DOMAINS: readonly string[] = [brand.domains.organization];

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Checks the format of an email that has already been normalized. */
export function isValidEmail(normalizedEmail: string): boolean {
  return normalizedEmail.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(normalizedEmail);
}

/** Parses a comma-separated domain list, e.g. the ALLOWED_EMAIL_DOMAINS env variable. */
export function parseAllowedDomains(value: string | undefined): string[] {
  const domains = (value ?? '')
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter((domain) => domain.length > 0);
  return domains.length > 0 ? domains : [...DEFAULT_ALLOWED_EMAIL_DOMAINS];
}

/**
 * Organization-only rule: the normalized email must be valid and the domain after the last "@"
 * must EXACTLY equal one of the allowed domains (no subdomains, no suffix matches).
 */
export function isAllowedEmail(email: string, allowedDomains: readonly string[]): boolean {
  const normalized = normalizeEmail(email);
  if (!isValidEmail(normalized)) {
    return false;
  }
  const domain = normalized.slice(normalized.lastIndexOf('@') + 1);
  return allowedDomains.some((allowed) => allowed.trim().toLowerCase() === domain);
}

/** User-facing error shown when an email's domain is not allowed. */
export function emailDomainNotAllowedMessage(allowedDomains: readonly string[]): string {
  const list = allowedDomains.map((domain) => `@${domain}`).join(' or ');
  return `Only ${list} email addresses can use ${brand.name}`;
}

/** Normalizes and validates an email's format (domain policy is checked separately). */
export const emailSchema = z
  .string()
  .transform(normalizeEmail)
  .refine(isValidEmail, { message: 'Enter a valid email address' });
