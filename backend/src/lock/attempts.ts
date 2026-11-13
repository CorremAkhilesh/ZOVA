import { PIN_ATTEMPTS_MAX } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import type { LockDoc } from '../db/lock-models.ts';
import { AppError } from '../lib/errors.ts';
import {
  isLockedOut,
  loadLock,
  lockClock,
  lockedOutError,
  lockModels,
  pepperOf,
  userOid,
} from './lock-store.ts';
import { verifyPin } from './pin-hash.ts';

const MINUTE_MS = 60_000;
export const LOCKOUT_FIRST_MS = MINUTE_MS;
export const LOCKOUT_MAX_MS = 60 * MINUTE_MS;
/** Lockouts count as "in a row" while the previous one started less than this long ago. */
export const LOCKOUT_DECAY_MS = 24 * 60 * MINUTE_MS;

/** 1, 2, 4, 8, 16, 32 minutes, then 1 hour for every later lockout in a row. */
export const lockoutMs = (previousLockouts: number) =>
  Math.min(LOCKOUT_FIRST_MS * 2 ** Math.max(0, previousLockouts), LOCKOUT_MAX_MS);

/** How many lockouts in a row came before, now. Old history no longer counts. */
export function lockoutLevel(doc: Pick<LockDoc, 'lockouts' | 'lastLockoutAt'>, now: Date): number {
  if (!doc.lastLockoutAt) return 0;
  const age = now.getTime() - new Date(doc.lastLockoutAt).getTime();
  return age < LOCKOUT_DECAY_MS ? doc.lockouts : 0;
}

/** The change one more wrong PIN makes: a higher count, or a lockout that resets the count. */
export function afterWrongPin(doc: LockDoc, now: Date) {
  const failed = doc.failedAttempts + 1;
  if (failed < PIN_ATTEMPTS_MAX) return { failedAttempts: failed };
  const level = lockoutLevel(doc, now);
  return {
    failedAttempts: 0,
    lockouts: level + 1,
    lastLockoutAt: now,
    lockedUntil: new Date(now.getTime() + lockoutMs(level)),
  };
}

/**
 * Counts one wrong PIN. Compare-and-set on the counters, so two wrong PINs sent at the same moment
 * are both counted and cannot slip past a lockout.
 */
async function recordWrongPin(app: FastifyInstance, userId: string): Promise<never> {
  const { Lock } = lockModels(app);
  for (let attempt = 0; attempt < 10; attempt++) {
    const doc = await loadLock(app, userId);
    const now = lockClock.now();
    if (!doc) break;
    if (isLockedOut(doc, now) && doc.lockedUntil) throw lockedOutError(doc.lockedUntil);
    const next = afterWrongPin(doc, now);
    const { matchedCount } = await Lock.updateOne(
      {
        _id: doc._id,
        failedAttempts: doc.failedAttempts,
        lockouts: doc.lockouts,
        lockedUntil: doc.lockedUntil,
      },
      { $set: { ...next, updatedAt: now } },
    );
    if (matchedCount === 0) continue;
    if (next.lockedUntil) throw lockedOutError(next.lockedUntil);
    throw new AppError('PIN_INVALID', 'Wrong PIN.', {
      attemptsLeft: PIN_ATTEMPTS_MAX - next.failedAttempts,
    });
  }
  throw new AppError('PIN_INVALID', 'Wrong PIN.', { attemptsLeft: 0 });
}

/**
 * A correct PIN (or fingerprint): the wrong-PIN count starts again. The lockout history stays
 * until it decays, so guessing between correct entries never gets cheaper.
 */
export async function recordCorrect(app: FastifyInstance, userId: string, clearLockout = false) {
  const now = lockClock.now();
  await lockModels(app).Lock.updateOne(
    { _id: userOid(userId) },
    {
      $set: {
        failedAttempts: 0,
        lastVerifiedAt: now,
        updatedAt: now,
        ...(clearLockout ? { lockedUntil: null } : {}),
      },
    },
  );
}

/**
 * Checks my PIN. While locked out every try is refused without looking at the PIN.
 * Throws PIN_NOT_SET, PIN_LOCKED_OUT or PIN_INVALID (with `attemptsLeft`).
 */
export async function checkPin(app: FastifyInstance, userId: string, pin: string) {
  const doc = await loadLock(app, userId);
  if (!doc?.pinHash) throw new AppError('PIN_NOT_SET', 'Set a PIN first.');
  if (isLockedOut(doc, lockClock.now()) && doc.lockedUntil) throw lockedOutError(doc.lockedUntil);
  if (!(await verifyPin(doc.pinHash, pin, pepperOf(app)))) return recordWrongPin(app, userId);
  await recordCorrect(app, userId);
  return doc;
}
