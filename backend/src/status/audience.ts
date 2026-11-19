import type { StatusPrivacy } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { oid } from '../chats/chats.service.ts';
import { registerStatusModels, type StatusDoc } from '../db/status-models.ts';
import { blockedEitherWay } from '../moderation/blocks.service.ts';
import { isHiddenAdmin, seesAdmins } from '../users/hidden-admins.ts';
import { type UserDoc, usersModel } from '../users/user-record.ts';

export const statusModels = (app: FastifyInstance) => registerStatusModels(app.mongo);

const DEFAULT_PRIVACY: StatusPrivacy = { mode: 'all', userIds: [] };

/** My status privacy (Settings → Privacy → Status). Index: { userId } unique. */
export async function statusPrivacyOf(
  app: FastifyInstance,
  userId: string,
): Promise<StatusPrivacy> {
  const doc = await statusModels(app)
    .StatusSettings.findOne({ userId: oid(userId) })
    .lean();
  if (!doc) return DEFAULT_PRIVACY;
  return { mode: doc.mode, userIds: doc.userIds.map(String) };
}

/** Takes effect for the statuses I post from now on; earlier ones keep theirs. */
export async function setStatusPrivacy(
  app: FastifyInstance,
  userId: string,
  privacy: StatusPrivacy,
): Promise<StatusPrivacy> {
  // Only real, distinct people, and never myself.
  const ids = [...new Set(privacy.userIds)].filter((id) => id !== userId);
  const saved: StatusPrivacy = { mode: privacy.mode, userIds: privacy.mode === 'all' ? [] : ids };
  await statusModels(app).StatusSettings.updateOne(
    { userId: oid(userId) },
    { $set: { mode: saved.mode, userIds: saved.userIds.map(oid), updatedAt: new Date() } },
    { upsert: true, setDefaultsOnInsert: false },
  );
  return saved;
}

/** Whether this status's audience includes `viewerId` (blocks and the owner are checked apart). */
export function audienceAllows(audience: StatusDoc['audience'], viewerId: string): boolean {
  const listed = audience.userIds.some((id) => id.toString() === viewerId);
  if (audience.mode === 'except') return !listed;
  if (audience.mode === 'only') return listed;
  return true;
}

/**
 * Everyone who may see a status of `ownerId` with this audience: active colleagues it allows,
 * minus anyone blocked either way, minus the owner. They hear about it as it changes.
 * Index: users { status, lastLoginAt } (status != deactivated).
 */
export async function recipientsOf(
  app: FastifyInstance,
  ownerId: string,
  audience: StatusDoc['audience'],
): Promise<Types.ObjectId[]> {
  const users = (await usersModel(app)
    .find(
      audience.mode === 'only'
        ? { _id: { $in: audience.userIds }, status: { $ne: 'deactivated' } }
        : { status: { $ne: 'deactivated' } },
    )
    .select({ _id: 1, email: 1, role: 1 })
    .lean()) as Pick<UserDoc, '_id' | 'email' | 'role'>[];
  // A hidden admin's status reaches admins only.
  const owner = (await usersModel(app).findById(ownerId).select({ email: 1 }).lean()) as Pick<
    UserDoc,
    'email'
  > | null;
  const ownerHidden = owner !== null && isHiddenAdmin(app, owner);
  const candidates = users
    .filter((user) => !ownerHidden || seesAdmins(user))
    .map((user) => user._id.toString())
    .filter((id) => id !== ownerId && audienceAllows(audience, id));
  const blocked = await blockedEitherWay(app, ownerId, candidates);
  return candidates.filter((id) => !blocked.has(id)).map((id) => new Types.ObjectId(id));
}
