import type { BlockedContact } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { registerModerationModels } from '../db/moderation-models.ts';
import { AppError } from '../lib/errors.ts';
import { toPublicProfile, type UserDoc, usersModel } from '../users/user-record.ts';

export const moderationModels = (app: FastifyInstance) => registerModerationModels(app.mongo);
const oid = (id: string) => new Types.ObjectId(id);

/** Whether either of two people blocked the other. */
export async function blockBetween(app: FastifyInstance, me: string, other: string) {
  const rows = await moderationModels(app)
    .Block.find({
      $or: [
        { userId: oid(me), blockedId: oid(other) },
        { userId: oid(other), blockedId: oid(me) },
      ],
    })
    .select({ userId: 1 })
    .lean();
  return {
    byMe: rows.some((row) => row.userId.toString() === me),
    byThem: rows.some((row) => row.userId.toString() === other),
  };
}

/** Direct chats: nothing goes either way while either person has blocked the other. */
export async function assertNotBlocked(app: FastifyInstance, me: string, other: string) {
  const { byMe, byThem } = await blockBetween(app, me, other);
  if (byMe) {
    throw new AppError('BLOCKED', 'You blocked this contact. Unblock them to send a message.');
  }
  if (byThem) throw new AppError('CANNOT_MESSAGE', 'You can’t send messages to this person.');
}

/** Of these people, the ones who blocked me: they see nothing of mine, and I see nothing of theirs. */
export async function blockersAmong(
  app: FastifyInstance,
  viewerId: string,
  userIds: Array<string | Types.ObjectId>,
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const rows = await moderationModels(app)
    .Block.find({ blockedId: oid(viewerId), userId: { $in: userIds.map(String).map(oid) } })
    .select({ userId: 1 })
    .lean();
  return new Set(rows.map((row) => row.userId.toString()));
}

/** Of these people, the ones blocked either way with me. Presence uses this. */
export async function blockedEitherWay(
  app: FastifyInstance,
  viewerId: string,
  userIds: string[],
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const ids = userIds.map(oid);
  const viewer = oid(viewerId);
  const rows = await moderationModels(app)
    .Block.find({
      $or: [
        { userId: viewer, blockedId: { $in: ids } },
        { blockedId: viewer, userId: { $in: ids } },
      ],
    })
    .select({ userId: 1, blockedId: 1 })
    .lean();
  return new Set(
    rows.map((row) => (row.userId.equals(viewer) ? row.blockedId : row.userId).toString()),
  );
}

/** Everyone who blocked me: I cannot find them in people search. */
export async function blockerIds(app: FastifyInstance, userId: string) {
  const rows = await moderationModels(app)
    .Block.find({ blockedId: oid(userId) })
    .select({ userId: 1 })
    .lean();
  return rows.map((row) => row.userId);
}

/** Everyone I blocked: their messages stay out of my message search. */
export async function blockedByMe(app: FastifyInstance, userId: string) {
  const rows = await moderationModels(app)
    .Block.find({ userId: oid(userId) })
    .select({ blockedId: 1 })
    .lean();
  return rows.map((row) => row.blockedId);
}

/** What changes for both people at once: presence stops, and my other devices hear about it. */
function announce(app: FastifyInstance, userId: string, otherId: string, blocked: boolean) {
  app.realtime.presence.blockChanged(userId, otherId);
  app.realtime.emitToUser(userId, 'blocks:changed', { userId: otherId, blocked });
}

export async function blockUser(app: FastifyInstance, userId: string, targetId: string) {
  if (userId === targetId) throw new AppError('BAD_REQUEST', 'You cannot block yourself.');
  const exists = await usersModel(app).exists({ _id: oid(targetId) });
  if (!exists) throw new AppError('NOT_FOUND', 'User not found.');
  await moderationModels(app).Block.updateOne(
    { userId: oid(userId), blockedId: oid(targetId) },
    { $setOnInsert: { createdAt: new Date() } },
    { upsert: true },
  );
  announce(app, userId, targetId, true);
  return { userId: targetId, blocked: true };
}

export async function unblockUser(app: FastifyInstance, userId: string, targetId: string) {
  await moderationModels(app).Block.deleteOne({ userId: oid(userId), blockedId: oid(targetId) });
  announce(app, userId, targetId, false);
  return { userId: targetId, blocked: false };
}

/** Settings → Privacy → Blocked contacts, newest first. */
export async function listBlocked(app: FastifyInstance, userId: string): Promise<BlockedContact[]> {
  const rows = await moderationModels(app)
    .Block.find({ userId: oid(userId) })
    .sort({ createdAt: -1, _id: -1 })
    .limit(1000)
    .lean();
  const users = (await usersModel(app)
    .find({ _id: { $in: rows.map((row) => row.blockedId) } })
    .lean()) as UserDoc[];
  const byId = new Map(users.map((user) => [user._id.toString(), user]));
  // Someone who blocked me back hides their photo and about from me, here as everywhere.
  const blockers = await blockersAmong(app, userId, [...byId.keys()]);
  return rows.flatMap((row) => {
    const user = byId.get(row.blockedId.toString());
    if (!user) return [];
    const profile = toPublicProfile(user, userId, {
      blockedViewer: blockers.has(user._id.toString()),
    });
    return [{ user: profile, blockedAt: row.createdAt.toISOString() }];
  });
}
