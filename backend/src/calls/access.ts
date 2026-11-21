import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { type UserDoc, usersModel } from '../users/user-record.ts';

export type CallsSetting = 'all' | 'admins' | 'off';

/**
 * Who may call, and be called (Admin → Settings, default from env CALLS_ENABLED_FOR): `all`;
 * `admins` (plus the CALLS_TEST_EMAILS accounts); or `off`, nobody.
 */
export function callsAllowed(
  setting: { calls: CallsSetting; testEmails: string[] },
  user: Pick<UserDoc, 'role' | 'email'>,
): boolean {
  if (setting.calls === 'all') return true;
  if (setting.calls === 'off') return false;
  return user.role === 'admin' || setting.testEmails.includes(user.email.toLowerCase());
}

/** What applies now in this process. */
export const callsSetting = (app: FastifyInstance) => ({
  calls: app.settings.current().calls,
  testEmails: app.env.CALLS_TEST_EMAILS,
});

/** One lookup by _id. */
export async function callsAllowedFor(app: FastifyInstance, userId: string): Promise<boolean> {
  const setting = callsSetting(app);
  if (setting.calls === 'all') return true;
  if (setting.calls === 'off') return false;
  if (!Types.ObjectId.isValid(userId)) return false;
  const user = (await usersModel(app)
    .findById(userId)
    .select({ role: 1, email: 1 })
    .lean()) as Pick<UserDoc, 'role' | 'email'> | null;
  return user ? callsAllowed(setting, user) : false;
}
