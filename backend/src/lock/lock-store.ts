import { type LockStatus, PIN_ATTEMPTS_MAX } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { type LockDoc, registerLockModels } from '../db/lock-models.ts';
import { AppError } from '../lib/errors.ts';
import { pinPepper } from './pin-hash.ts';

/** Replaceable in tests, so lockouts and expiries can be checked without waiting. */
export const lockClock = { now: (): Date => new Date() };

export const lockModels = (app: FastifyInstance) => registerLockModels(app.mongo);
export const userOid = (userId: string) => new Types.ObjectId(userId);
export const pepperOf = (app: FastifyInstance) => pinPepper(app.env.AUTH_SECRET);

/** Every check of a PIN or code, per person: generous for typing, useless for guessing. */
export const PIN_RATE_LIMIT = { max: 20, windowSeconds: 60 };

export async function assertPinRate(app: FastifyInstance, userId: string) {
  const key = `zuvo:rate:pin:${userId}`;
  if ((await app.counterStore.increment(key, PIN_RATE_LIMIT.windowSeconds)) > PIN_RATE_LIMIT.max) {
    throw new AppError('RATE_LIMITED', 'Too many tries. Wait a minute.', {
      retryAfterSeconds: Math.max(1, await app.counterStore.ttl(key)),
    });
  }
}

export async function loadLock(app: FastifyInstance, userId: string): Promise<LockDoc | null> {
  return (await lockModels(app).Lock.findById(userOid(userId)).lean()) as LockDoc | null;
}

/** The person's lock document, created with defaults on first use. */
export async function ensureLock(app: FastifyInstance, userId: string): Promise<LockDoc> {
  return (await lockModels(app)
    .Lock.findOneAndUpdate(
      { _id: userOid(userId) },
      { $setOnInsert: { updatedAt: lockClock.now() } },
      { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
    )
    .lean()) as LockDoc;
}

export const isLockedOut = (doc: Pick<LockDoc, 'lockedUntil'> | null, now: Date) =>
  !!doc?.lockedUntil && new Date(doc.lockedUntil).getTime() > now.getTime();

export function lockedOutError(lockedUntil: Date) {
  return new AppError('PIN_LOCKED_OUT', 'Too many wrong PINs. Try again later.', {
    lockedUntil: new Date(lockedUntil).toISOString(),
  });
}

export function toLockStatus(doc: LockDoc | null, biometricCount: number, now: Date): LockStatus {
  const pinSet = !!doc?.pinHash;
  const lockedOut = isLockedOut(doc, now);
  const idle = doc?.idleMinutes;
  return {
    pinSet,
    appLock: {
      enabled: pinSet && doc?.appLockEnabled === true,
      idleMinutes: idle === 1 || idle === 15 || idle === 60 ? idle : 5,
    },
    lockedUntil: lockedOut && doc?.lockedUntil ? new Date(doc.lockedUntil).toISOString() : null,
    attemptsLeft: lockedOut ? 0 : Math.max(0, PIN_ATTEMPTS_MAX - (doc?.failedAttempts ?? 0)),
    biometricCount,
  };
}

export async function lockStatus(app: FastifyInstance, userId: string): Promise<LockStatus> {
  const [doc, biometricCount] = await Promise.all([
    loadLock(app, userId),
    lockModels(app).LockCredential.countDocuments({ userId: userOid(userId) }),
  ]);
  return toLockStatus(doc, biometricCount, lockClock.now());
}

/** Tells my devices to fetch the lock again; returns the new status. */
export async function announceLock(app: FastifyInstance, userId: string) {
  app.realtime.emitToUser(userId, 'lock:updated', {});
  return lockStatus(app, userId);
}
