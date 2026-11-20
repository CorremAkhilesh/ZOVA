import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { type UserDoc, usersModel } from '../users/user-record.ts';

/**
 * Feature flag. CALLS_ENABLED_FOR=admins (the default): only admins and the CALLS_TEST_EMAILS accounts
 * may call, and be called. `all`: everyone.
 */
export function callsAllowed(
  env: { CALLS_ENABLED_FOR: 'admins' | 'all'; CALLS_TEST_EMAILS: string[] },
  user: Pick<UserDoc, 'role' | 'email'>,
): boolean {
  if (env.CALLS_ENABLED_FOR === 'all') return true;
  return user.role === 'admin' || env.CALLS_TEST_EMAILS.includes(user.email.toLowerCase());
}

/** One lookup by _id. */
export async function callsAllowedFor(app: FastifyInstance, userId: string): Promise<boolean> {
  if (app.env.CALLS_ENABLED_FOR === 'all') return true;
  if (!Types.ObjectId.isValid(userId)) return false;
  const user = (await usersModel(app)
    .findById(userId)
    .select({ role: 1, email: 1 })
    .lean()) as Pick<UserDoc, 'role' | 'email'> | null;
  return user ? callsAllowed(app.env, user) : false;
}
