import type { AdminSecurity } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { registerAuthModels } from '../db/auth-models.ts';
import { AppError } from '../lib/errors.ts';
import {
  findLock,
  markUnlocked,
  recentFailures,
  runningLocks,
} from '../security/security-events.ts';
import { type Actor, audit } from './admin.service.ts';

/**
 * GET /v1/admin/security: signed-in devices and people now (index: expiresAt), emails locked for
 * the day, and the latest wrong codes with masked addresses.
 */
export async function adminSecurity(
  app: FastifyInstance,
  now = new Date(),
): Promise<AdminSecurity> {
  const { AuthSession } = registerAuthModels(app.mongo);
  const live = { expiresAt: { $gt: now } };
  const [active, people, locks, failures] = await Promise.all([
    AuthSession.countDocuments(live),
    AuthSession.distinct('userId', live),
    runningLocks(app, now),
    recentFailures(app),
  ]);
  return {
    sessions: { active, people: new Set(people.map(String)).size },
    locks: locks.map((lock) => ({
      id: lock._id.toString(),
      email: lock.email,
      ip: lock.ip,
      lockedAt: lock.at.toISOString(),
      until: (lock.until ?? lock.at).toISOString(),
    })),
    failures: failures.map((row) => ({ email: row.email, ip: row.ip, at: row.at.toISOString() })),
  };
}

/** Ends an email's lock for the day now, with a fresh daily count. Audited `security.unlock`. */
export async function unlockEmail(app: FastifyInstance, actor: Actor, id: string, reason: string) {
  const lock = await findLock(app, id);
  if (lock?.kind !== 'otp_locked') throw new AppError('NOT_FOUND', 'Lock not found.');
  await app.otpThrottle.unlock(lock.email);
  if (!lock.unlockedAt) {
    await markUnlocked(app, lock._id, actor.email);
    await audit(
      app,
      actor,
      'security.unlock',
      { _id: new Types.ObjectId(actor.id), email: actor.email },
      { reason, details: { email: lock.email } },
    );
  }
  return { unlocked: true as const };
}
