import type { StatusFeedResponse, StatusReply, StatusViewersResponse } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import type { Types } from 'mongoose';
import { oid } from '../chats/chats.service.ts';
import type { StatusDoc } from '../db/status-models.ts';
import { AppError } from '../lib/errors.ts';
import { blockedEitherWay } from '../moderation/blocks.service.ts';
import { privacyOf, toPublicProfile, type UserDoc, usersModel } from '../users/user-record.ts';
import { audienceAllows, statusModels } from './audience.ts';
import { toStatus } from './status.service.ts';

const isActive = (user: UserDoc | undefined): user is UserDoc =>
  Boolean(user) && user?.status !== 'deactivated';

/** Read receipts are off for this person: their views are not shown, nor do they see others'. */
const sharesViews = (user: UserDoc | undefined) => Boolean(user && privacyOf(user).readReceipts);

/**
 * A status `userId` may see: still running, its owner active, its audience naming them, and nobody
 * blocked either way. Otherwise it does not exist (404), as for someone else's message.
 */
export async function requireVisibleStatus(
  app: FastifyInstance,
  userId: string,
  id: string,
): Promise<StatusDoc> {
  const doc = await statusModels(app).Status.findById(id).lean();
  if (!doc || doc.expiresAt <= new Date()) throw new AppError('NOT_FOUND', 'Status not found.');
  const ownerId = doc.userId.toString();
  if (ownerId === userId) return doc;
  const owner = (await usersModel(app).findById(doc.userId).lean()) as UserDoc | null;
  const blocked = await blockedEitherWay(app, userId, [ownerId]);
  if (!isActive(owner ?? undefined) || blocked.size > 0 || !audienceAllows(doc.audience, userId)) {
    throw new AppError('NOT_FOUND', 'Status not found.');
  }
  return doc;
}

/** Whether a running status that uses this file can be seen by `userId` (media access). */
export async function statusShowsMedia(
  app: FastifyInstance,
  userId: string,
  mediaId: string,
): Promise<boolean> {
  // Index: { mediaId } (partial).
  const doc = await statusModels(app)
    .Status.findOne({ mediaId: oid(mediaId) })
    .lean();
  if (!doc) return false;
  return requireVisibleStatus(app, userId, doc._id.toString()).then(
    () => true,
    () => false,
  );
}

/**
 * A reply to a status goes to its owner, in our 1:1 chat (`peerId` is the chat's other person), with
 * a small copy of what it answers. Only a status I may see.
 */
export async function statusReplyOf(
  app: FastifyInstance,
  userId: string,
  peerId: string | null,
  statusId: string,
): Promise<StatusReply> {
  const doc = await requireVisibleStatus(app, userId, statusId);
  if (!peerId || doc.userId.toString() !== peerId) {
    throw new AppError('BAD_REQUEST', 'A status reply goes to its owner, in a 1:1 chat.');
  }
  return {
    statusId: doc._id.toString(),
    ownerId: peerId,
    kind: doc.kind,
    text: doc.text,
    style: doc.style,
    mediaId: doc.media?.hasThumbnail ? (doc.mediaId?.toString() ?? null) : null,
    hasThumbnail: doc.media?.hasThumbnail === true,
    expiresAt: doc.expiresAt.toISOString(),
  };
}

/** My statuses, then everyone's I may see, newest first; muted people flagged. */
export async function statusFeed(
  app: FastifyInstance,
  userId: string,
): Promise<StatusFeedResponse> {
  const { Status, StatusView, StatusMute } = statusModels(app);
  const now = new Date();
  // Index: { expiresAt } (range): only what is still running, oldest first.
  const running = await Status.find({ expiresAt: { $gt: now } })
    .sort({ expiresAt: 1 })
    .lean();
  const ownerIds = [...new Set(running.map((doc) => doc.userId.toString()))];
  const users = (await usersModel(app)
    .find({ _id: { $in: ownerIds.map(oid) } })
    .lean()) as UserDoc[];
  const byId = new Map(users.map((user) => [user._id.toString(), user]));
  const blocked = await blockedEitherWay(
    app,
    userId,
    ownerIds.filter((id) => id !== userId),
  );
  const visible = running.filter((doc) => {
    const owner = doc.userId.toString();
    if (owner === userId) return true;
    return isActive(byId.get(owner)) && !blocked.has(owner) && audienceAllows(doc.audience, userId);
  });
  const ids = visible.map((doc) => doc._id);
  // Index: { viewerId, statusId }.
  const seen = await StatusView.find({ viewerId: oid(userId), statusId: { $in: ids } })
    .select({ statusId: 1 })
    .lean();
  const seenIds = new Set(seen.map((row) => row.statusId.toString()));
  // Index: { userId, mutedUserId } unique.
  const mutes = await StatusMute.find({ userId: oid(userId) })
    .select({ mutedUserId: 1 })
    .lean();
  const muted = new Set(mutes.map((row) => row.mutedUserId.toString()));
  const me = byId.get(userId);
  const mineDocs = visible.filter((doc) => doc.userId.toString() === userId);
  const counts = sharesViews(me)
    ? await viewCounts(
        app,
        mineDocs.map((doc) => doc._id),
      )
    : null;

  const mine = mineDocs.map((doc) =>
    toStatus(doc, {
      viewed: true,
      viewCount: counts?.get(doc._id.toString()) ?? (counts ? 0 : null),
    }),
  );
  const grouped = new Map<string, StatusDoc[]>();
  for (const doc of visible) {
    const owner = doc.userId.toString();
    if (owner !== userId) grouped.set(owner, [...(grouped.get(owner) ?? []), doc]);
  }
  const people = [...grouped.entries()]
    .map(([owner, docs]) => ({
      user: toPublicProfile(byId.get(owner) as UserDoc, userId),
      statuses: docs
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((doc) => toStatus(doc, { viewed: seenIds.has(doc._id.toString()), viewCount: null })),
      muted: muted.has(owner),
    }))
    .sort((a, b) => latest(b) - latest(a));
  return { mine: mine.sort((a, b) => a.createdAt.localeCompare(b.createdAt)), people };
}

const latest = (person: { statuses: { createdAt: string }[] }) =>
  Date.parse(person.statuses.at(-1)?.createdAt ?? '0');

/** How many have seen each of these (people sharing read receipts only). */
async function viewCounts(app: FastifyInstance, ids: Types.ObjectId[]) {
  const counts = new Map<string, number>();
  for (const id of ids) {
    const viewers = await sharingViewers(app, id);
    counts.set(id.toString(), viewers.length);
  }
  return counts;
}

/** Views of one status by people whose read receipts are on, newest first. */
async function sharingViewers(app: FastifyInstance, statusId: Types.ObjectId) {
  // Index: { statusId, viewedAt }.
  const views = await statusModels(app).StatusView.find({ statusId }).sort({ viewedAt: -1 }).lean();
  if (views.length === 0) return [];
  const users = (await usersModel(app)
    .find({ _id: { $in: views.map((view) => view.viewerId) } })
    .lean()) as UserDoc[];
  const byId = new Map(users.map((user) => [user._id.toString(), user]));
  return views.flatMap((view) => {
    const user = byId.get(view.viewerId.toString());
    return isActive(user) && sharesViews(user) ? [{ view, user }] : [];
  });
}

/** Seen (once; a later reaction replaces the earlier one). The owner's own views are not counted. */
export async function viewStatus(
  app: FastifyInstance,
  userId: string,
  id: string,
  reaction: string | null | undefined,
): Promise<void> {
  const doc = await requireVisibleStatus(app, userId, id);
  if (doc.userId.toString() === userId) return;
  await statusModels(app).StatusView.updateOne(
    { statusId: doc._id, viewerId: oid(userId) },
    {
      $setOnInsert: {
        ownerId: doc.userId,
        viewedAt: new Date(),
        ...(reaction === undefined ? { reaction: null } : {}),
      },
      ...(reaction !== undefined ? { $set: { reaction } } : {}),
    },
    { upsert: true, setDefaultsOnInsert: false },
  );
}

/** "Viewed by" on one of my statuses. Empty while my own read receipts are off. */
export async function statusViewers(
  app: FastifyInstance,
  userId: string,
  id: string,
): Promise<StatusViewersResponse> {
  const doc = await statusModels(app).Status.findById(id).lean();
  if (!doc || doc.userId.toString() !== userId)
    throw new AppError('NOT_FOUND', 'Status not found.');
  const me = (await usersModel(app).findById(userId).lean()) as UserDoc | null;
  if (!sharesViews(me ?? undefined)) return { viewers: [], count: 0 };
  const viewers = await sharingViewers(app, doc._id);
  return {
    viewers: viewers.map(({ view, user }) => ({
      user: toPublicProfile(user, userId),
      viewedAt: view.viewedAt.toISOString(),
      reaction: view.reaction ?? null,
    })),
    count: viewers.length,
  };
}

/** Mute or unmute someone's statuses: they move to "Muted" in my list. Nobody else knows. */
export async function setStatusMute(
  app: FastifyInstance,
  userId: string,
  otherId: string,
  muted: boolean,
): Promise<void> {
  if (otherId === userId) throw new AppError('BAD_REQUEST', 'You cannot mute yourself.');
  const { StatusMute } = statusModels(app);
  const key = { userId: oid(userId), mutedUserId: oid(otherId) };
  if (muted) {
    await StatusMute.updateOne(
      key,
      { $setOnInsert: { createdAt: new Date() } },
      { upsert: true, setDefaultsOnInsert: false },
    );
  } else {
    await StatusMute.deleteOne(key);
  }
  app.realtime.emitToUser(userId, 'status:changed', {});
}
