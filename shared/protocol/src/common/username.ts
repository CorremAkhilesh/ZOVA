import { z } from 'zod';

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
/** A username can be changed at most once in this many days (setting the first one is free). */
export const USERNAME_CHANGE_INTERVAL_DAYS = 30;

/** Names nobody can claim: roles, brand and system words, common impersonation targets. */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  'admin',
  'administrator',
  'root',
  'superuser',
  'sysadmin',
  'support',
  'help',
  'helpdesk',
  'system',
  'security',
  'official',
  'staff',
  'team',
  'mod',
  'moderator',
  'owner',
  'zuvo',
  'zuvoapp',
  'correm',
  'corremadvisory',
  'noreply',
  'no_reply',
  'nova',
  'info',
  'contact',
  'billing',
  'api',
  'app',
  'www',
  'mail',
  'email',
  'null',
  'undefined',
  'me',
  'you',
  'everyone',
  'all',
  'here',
  'channel',
  'bot',
]);

/** Lowercase letters, digits, underscore and dot; starts with a letter; no "..", no trailing dot. */
const USERNAME_PATTERN = /^[a-z](?:[a-z0-9_]|\.(?=[a-z0-9_]))*$/;

export type UsernameProblem = 'too_short' | 'too_long' | 'invalid' | 'reserved';

export function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, '').toLowerCase();
}

/** Returns why a (normalized) username is not allowed, or null when it is fine. */
export function usernameProblem(username: string): UsernameProblem | null {
  if (username.length < USERNAME_MIN) return 'too_short';
  if (username.length > USERNAME_MAX) return 'too_long';
  if (!USERNAME_PATTERN.test(username)) return 'invalid';
  if (RESERVED_USERNAMES.has(username)) return 'reserved';
  return null;
}

const MESSAGES: Record<UsernameProblem, string> = {
  too_short: `Use at least ${USERNAME_MIN} characters`,
  too_long: `Use at most ${USERNAME_MAX} characters`,
  invalid: 'Use lowercase letters, numbers, _ and . — start with a letter, no double dots',
  reserved: 'This username is reserved',
};

/** Normalizes ("@Asha" → "asha") and validates. */
export const usernameSchema = z
  .string()
  .transform(normalizeUsername)
  .superRefine((value, ctx) => {
    const problem = usernameProblem(value);
    if (problem) ctx.addIssue({ code: 'custom', message: MESSAGES[problem], params: { problem } });
  });

/**
 * A valid starting point from an email's local part: "Akhilesh.Kumar+x@…" → "akhilesh.kumar".
 * The server appends a number when it is taken or reserved.
 */
export function usernameBaseFromEmail(email: string): string {
  const local = (email.split('@')[0] ?? '').toLowerCase().split('+')[0] ?? '';
  let base = local
    .replace(/[^a-z0-9_.]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^[^a-z]+/, '');
  base = base.slice(0, USERNAME_MAX - 3).replace(/\.+$/, '');
  if (base.length < USERNAME_MIN) base = `user${base}`.slice(0, USERNAME_MAX - 3);
  return base;
}
