import type { AppLockIdle } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { announceOwnChat } from '../chats/chat-prefs.service.ts';
import { chatModels } from '../chats/chats.service.ts';
import { logUpdates } from '../chats/updates.ts';
import { requireParticipant } from '../chats/visibility.ts';
import { AppError } from '../lib/errors.ts';
import { checkPin } from './attempts.ts';
import {
  announceLock,
  assertPinRate,
  ensureLock,
  loadLock,
  lockClock,
  lockModels,
  pepperOf,
  userOid,
} from './lock-store.ts';
import { hashPin } from './pin-hash.ts';

/** Sets my PIN, or changes it: an existing PIN must be given, and a wrong one counts as a try. */
export async function setPin(
  app: FastifyInstance,
  userId: string,
  body: { pin: string; currentPin?: string | undefined },
) {
  const existing = await loadLock(app, userId);
  if (existing?.pinHash) {
    if (!body.currentPin) throw new AppError('BAD_REQUEST', 'Enter your current PIN.');
    await assertPinRate(app, userId);
    await checkPin(app, userId, body.currentPin);
  }
  await ensureLock(app, userId);
  const now = lockClock.now();
  const pinHash = await hashPin(body.pin, pepperOf(app));
  // Only over the PIN that was checked: two changes at once cannot both win.
  const { matchedCount } = await lockModels(app).Lock.updateOne(
    { _id: userOid(userId), pinHash: existing?.pinHash ?? null },
    { $set: { pinHash, failedAttempts: 0, lastVerifiedAt: now, reset: null, updatedAt: now } },
  );
  if (matchedCount === 0) throw new AppError('CONFLICT', 'Your PIN just changed. Try again.');
  return announceLock(app, userId);
}

/**
 * Removes my PIN (the PIN is required): app lock goes off and fingerprints go too. Locked chats
 * keep their flag, so the app asks for a new PIN before opening them.
 */
export async function removePin(app: FastifyInstance, userId: string, pin: string) {
  await assertPinRate(app, userId);
  await checkPin(app, userId, pin);
  await lockModels(app).Lock.updateOne(
    { _id: userOid(userId) },
    {
      $set: {
        pinHash: null,
        appLockEnabled: false,
        challenge: null,
        reset: null,
        updatedAt: lockClock.now(),
      },
    },
  );
  await lockModels(app).LockCredential.deleteMany({ userId: userOid(userId) });
  return announceLock(app, userId);
}

/** Unlocks: checks the PIN, counting wrong ones. */
export async function verifyLockPin(app: FastifyInstance, userId: string, pin: string) {
  await assertPinRate(app, userId);
  await checkPin(app, userId, pin);
  return announceLock(app, userId);
}

export async function updateLockSettings(
  app: FastifyInstance,
  userId: string,
  appLock: { enabled: boolean; idleMinutes: AppLockIdle },
) {
  const doc = await loadLock(app, userId);
  if (appLock.enabled && !doc?.pinHash) {
    throw new AppError('PIN_NOT_SET', 'Set a PIN before turning on app lock.');
  }
  await ensureLock(app, userId);
  await lockModels(app).Lock.updateOne(
    { _id: userOid(userId) },
    {
      $set: {
        appLockEnabled: appLock.enabled,
        idleMinutes: appLock.idleMinutes,
        updatedAt: lockClock.now(),
      },
    },
  );
  return announceLock(app, userId);
}

/** Locks or unlocks one of my chats, for me only. Locking needs a PIN. */
export async function setChatLock(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  locked: boolean,
) {
  const member = await requireParticipant(app, chatId, userId);
  if (locked && !(await loadLock(app, userId))?.pinHash) {
    throw new AppError('PIN_NOT_SET', 'Set a PIN before locking a chat.');
  }
  const models = chatModels(app);
  const now = new Date();
  const cursors = await app.mongo.transaction(async (session) => {
    await models.ChatMember.updateOne({ _id: member._id }, { $set: { locked } }, { session });
    return logUpdates(
      models,
      session,
      [member.userId],
      { kind: 'chat', chatId: member.chatId },
      now,
    );
  });
  const chat = await announceOwnChat(app, userId, chatId, cursors.get(userId) ?? '0');
  app.realtime.emitToUser(userId, 'lock:updated', {});
  return chat;
}
