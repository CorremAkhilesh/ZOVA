import type { FastifyInstance } from 'fastify';
import { AppError } from '../lib/errors.ts';
import { usersModel } from '../users/user-record.ts';
import {
  type Actor,
  assertNotLastAdmin,
  assertNotSelf,
  audit,
  findTarget,
} from './admin.service.ts';
import { endSessions } from './user-actions.ts';

/** The shortest and longest suspension an admin can set. */
export const SUSPEND_MIN_MS = 5 * 60_000;
export const SUSPEND_MAX_DAYS = 366;

/**
 * Suspends someone until a date: every device is signed out now, and sign-in is refused (with the
 * date and the reason) until then. It ends on its own at that moment: nothing has to run. Never
 * yourself, never the last admin. Audited `user.suspend`.
 */
export async function suspendUser(
  app: FastifyInstance,
  actor: Actor,
  id: string,
  until: Date,
  reason: string,
  now = new Date(),
) {
  if (until.getTime() < now.getTime() + SUSPEND_MIN_MS) {
    throw new AppError('BAD_REQUEST', 'Choose a time at least a few minutes from now.', {
      field: 'until',
    });
  }
  if (until.getTime() > now.getTime() + SUSPEND_MAX_DAYS * 86_400_000) {
    throw new AppError('BAD_REQUEST', 'A suspension can last at most a year. Deactivate instead.', {
      field: 'until',
    });
  }
  const target = await findTarget(app, id);
  assertNotSelf(actor, target, 'suspend');
  await assertNotLastAdmin(app, target);
  if (target.status === 'deactivated') {
    throw new AppError('CONFLICT', 'This account is deactivated. Reactivate it first.');
  }
  // Block new sign-ins first, then close what is open.
  await usersModel(app).updateOne(
    { _id: target._id },
    { $set: { suspendedUntil: until, suspendReason: reason } },
  );
  const revokedSessions = await endSessions(app, id);
  await audit(app, actor, 'user.suspend', target, {
    reason,
    details: { until: until.toISOString(), sessions: revokedSessions },
  });
  return { suspendedUntil: until.toISOString(), revokedSessions };
}

/** Ends a suspension early. Audited `user.unsuspend`; nothing to do if none is running. */
export async function unsuspendUser(
  app: FastifyInstance,
  actor: Actor,
  id: string,
  reason: string,
) {
  const target = await findTarget(app, id);
  if (target.suspendedUntil) {
    await usersModel(app).updateOne(
      { _id: target._id },
      { $unset: { suspendedUntil: '', suspendReason: '' } },
    );
    await audit(app, actor, 'user.unsuspend', target, { reason });
  }
  return { suspendedUntil: null };
}
