import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { OTP_MAX_ATTEMPTS, OTP_RESEND_COOLDOWN_SECONDS, OTP_TTL_SECONDS } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../lib/errors.ts';
import { lockResetEmail } from '../mail/templates/lock-reset-email.tsx';
import { requireUser } from '../users/users.service.ts';
import {
  announceLock,
  assertPinRate,
  loadLock,
  lockClock,
  lockModels,
  userOid,
} from './lock-store.ts';

/** "Forgot PIN" codes per person per hour, like sign-in codes. */
export const RESET_CODES_PER_HOUR = 5;
const HOUR_SECONDS = 3600;

/** Codes are stored as an HMAC keyed with AUTH_SECRET, never as they are. */
const hashCode = (app: FastifyInstance, code: string) =>
  createHmac('sha256', app.env.AUTH_SECRET).update(`zuvo:pin-reset:${code}`).digest('hex');

function sameHash(a: string, b: string) {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

async function assertResetThrottle(app: FastifyInstance, userId: string) {
  const store = app.counterStore;
  const cooldown = `zuvo:pin-reset:cooldown:${userId}`;
  if (!(await store.setIfAbsent(cooldown, OTP_RESEND_COOLDOWN_SECONDS))) {
    throw new AppError('RATE_LIMITED', 'Please wait before asking for a new code.', {
      retryAfterSeconds: Math.max(1, await store.ttl(cooldown)),
    });
  }
  const hourly = `zuvo:pin-reset:hour:${userId}`;
  if ((await store.increment(hourly, HOUR_SECONDS)) > RESET_CODES_PER_HOUR) {
    throw new AppError('RATE_LIMITED', 'Too many codes asked for. Try again later.', {
      retryAfterSeconds: Math.max(1, await store.ttl(hourly)),
    });
  }
}

/** Emails a 6-digit code to my own account email. Only the latest code works. */
export async function requestPinReset(app: FastifyInstance, userId: string) {
  if (!(await loadLock(app, userId))?.pinHash) {
    throw new AppError('PIN_NOT_SET', 'There is no PIN to reset.');
  }
  await assertResetThrottle(app, userId);
  const user = await requireUser(app, userId);
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
  const now = lockClock.now();
  const expiresAt = new Date(now.getTime() + OTP_TTL_SECONDS * 1000);
  await lockModels(app).Lock.updateOne(
    { _id: userOid(userId) },
    { $set: { reset: { codeHash: hashCode(app, code), expiresAt, attempts: 0 }, updatedAt: now } },
  );
  const message = await lockResetEmail(user.email, {
    code,
    expiresAt,
    minutes: OTP_TTL_SECONDS / 60,
  });
  await app.emailDispatcher.dispatch(message, 'lock-reset');
  return { sent: true as const };
}

/**
 * The code from the email: removes the PIN, wrong-PIN counting, lockouts and fingerprints, and
 * turns app lock off. Locked chats stay locked: the app asks for a new PIN.
 */
export async function confirmPinReset(app: FastifyInstance, userId: string, code: string) {
  await assertPinRate(app, userId);
  const { Lock, LockCredential } = lockModels(app);
  const now = lockClock.now();
  // Counted before the comparison, atomically: parallel guesses cannot exceed the attempts.
  const doc = await Lock.findOneAndUpdate(
    {
      _id: userOid(userId),
      'reset.expiresAt': { $gt: now },
      'reset.attempts': { $lt: OTP_MAX_ATTEMPTS },
    },
    { $inc: { 'reset.attempts': 1 } },
    { returnDocument: 'after' },
  ).lean();
  if (!doc?.reset) {
    const current = await loadLock(app, userId);
    const expired = !current?.reset || new Date(current.reset.expiresAt) <= now;
    throw expired
      ? new AppError('OTP_EXPIRED', 'This code has expired. Ask for a new one.')
      : new AppError('OTP_ATTEMPTS_EXCEEDED', 'Too many wrong codes. Ask for a new one.');
  }
  if (!sameHash(doc.reset.codeHash, hashCode(app, code))) {
    throw new AppError('OTP_INVALID', 'Wrong code.', {
      attemptsLeft: Math.max(0, OTP_MAX_ATTEMPTS - doc.reset.attempts),
    });
  }
  // Only the code that was just checked can be used, and only once.
  const { matchedCount } = await Lock.updateOne(
    { _id: doc._id, 'reset.codeHash': doc.reset.codeHash },
    {
      $set: {
        pinHash: null,
        appLockEnabled: false,
        failedAttempts: 0,
        lockouts: 0,
        lastLockoutAt: null,
        lockedUntil: null,
        lastVerifiedAt: null,
        challenge: null,
        reset: null,
        updatedAt: now,
      },
    },
  );
  if (matchedCount === 0) throw new AppError('OTP_EXPIRED', 'This code was already used.');
  await LockCredential.deleteMany({ userId: doc._id });
  return announceLock(app, userId);
}
