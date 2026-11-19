import {
  type CreateStatusBody,
  STATUS_PER_DAY_MAX,
  STATUS_TTL_HOURS,
  STATUS_VIDEO_MAX_SECONDS,
  type Status,
} from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { type Actor, audit, findTarget } from '../admin/admin.service.ts';
import { chatModels, oid } from '../chats/chats.service.ts';
import { logUpdates } from '../chats/updates.ts';
import type { StatusDoc } from '../db/status-models.ts';
import { AppError } from '../lib/errors.ts';
import { toMediaInfo } from '../media/media.service.ts';
import { recipientsOf, statusModels, statusPrivacyOf } from './audience.ts';

/** As the app shows it. `viewCount` is for the owner only. */
export function toStatus(
  doc: StatusDoc,
  extra: { viewed: boolean; viewCount: number | null },
): Status {
  return {
    id: doc._id.toString(),
    userId: doc.userId.toString(),
    kind: doc.kind,
    text: doc.text,
    style: doc.style,
    media: doc.media,
    createdAt: doc.createdAt.toISOString(),
    expiresAt: doc.expiresAt.toISOString(),
    ...extra,
  };
}

/**
 * Everyone who may see it, and me on my other devices, hear that statuses changed: a line in each
 * person's sync log (kind `status`, so a device that was away reloads them) and a socket event.
 */
export async function announceStatus(app: FastifyInstance, doc: StatusDoc): Promise<void> {
  const people = [doc.userId, ...(await recipientsOf(app, doc.userId.toString(), doc.audience))];
  const models = chatModels(app);
  await app.mongo.transaction((session) =>
    logUpdates(models, session, people, { kind: 'status', chatId: doc._id }, new Date()),
  );
  for (const id of people) app.realtime.emitToUser(id.toString(), 'status:changed', {});
}

/** A finished photo or video of mine, not used anywhere yet; a video at most 60 seconds long. */
async function claimMedia(
  app: FastifyInstance,
  userId: string,
  body: Extract<CreateStatusBody, { mediaId: string }>,
  statusId: Types.ObjectId,
  expiresAt: Date,
) {
  const { Media } = chatModels(app);
  const doc = await Media.findOne({
    _id: oid(body.mediaId),
    ownerId: oid(userId),
    status: 'ready',
    messageId: null,
  }).lean();
  if (!doc || doc.kind !== body.kind) {
    throw new AppError('MEDIA_NOT_ATTACHABLE', 'This file cannot be used for a status.');
  }
  if (body.kind === 'video' && (doc.duration ?? 0) > STATUS_VIDEO_MAX_SECONDS + 0.5) {
    throw new AppError('STATUS_VIDEO_TOO_LONG', 'A video status can be up to 60 seconds long.');
  }
  // In use from now on (never an orphan), and removed by the media cleanup once the status ends.
  const claimed = await Media.updateOne(
    { _id: doc._id, messageId: null },
    { $set: { messageId: statusId, deleteRequestedAt: expiresAt } },
  );
  if (claimed.modifiedCount === 0) {
    throw new AppError('MEDIA_NOT_ATTACHABLE', 'This file cannot be used for a status.');
  }
  return toMediaInfo(doc);
}

/** Posts a status for the next 24 hours, to the people my status privacy names right now. */
export async function createStatus(
  app: FastifyInstance,
  userId: string,
  body: CreateStatusBody,
): Promise<Status> {
  const { Status } = statusModels(app);
  const now = new Date();
  // Every status still running was posted in the last 24 hours. Index: { userId, expiresAt }.
  const recent = await Status.countDocuments({ userId: oid(userId), expiresAt: { $gt: now } });
  if (recent >= STATUS_PER_DAY_MAX) {
    throw new AppError('STATUS_LIMIT_REACHED', 'You have posted the most statuses for today.');
  }
  const privacy = await statusPrivacyOf(app, userId);
  const id = new Types.ObjectId();
  const expiresAt = new Date(now.getTime() + STATUS_TTL_HOURS * 3_600_000);
  const media = body.kind === 'text' ? null : await claimMedia(app, userId, body, id, expiresAt);
  const doc: StatusDoc = {
    _id: id,
    userId: oid(userId),
    kind: body.kind,
    text: body.kind === 'text' ? body.text : body.caption || null,
    style: body.kind === 'text' ? body.style : null,
    mediaId: body.kind === 'text' ? null : oid(body.mediaId),
    media,
    audience: { mode: privacy.mode, userIds: privacy.userIds.map(oid) },
    createdAt: now,
    expiresAt,
  };
  await Status.create(doc);
  await announceStatus(app, doc);
  return toStatus(doc, { viewed: true, viewCount: 0 });
}

/** Gone for everyone at once, its views and its file with it. */
async function removeStatus(app: FastifyInstance, doc: StatusDoc): Promise<void> {
  const { Status, StatusView } = statusModels(app);
  await Status.deleteOne({ _id: doc._id });
  await StatusView.deleteMany({ statusId: doc._id });
  if (doc.mediaId) {
    await chatModels(app).Media.updateOne(
      { _id: doc.mediaId },
      { $set: { deleteRequestedAt: new Date() } },
    );
  }
  await announceStatus(app, doc);
}

/** Mine only. Someone else's looks as if it does not exist. */
export async function deleteStatus(app: FastifyInstance, userId: string, id: string) {
  const doc = await statusModels(app).Status.findById(id).lean();
  if (!doc || doc.userId.toString() !== userId)
    throw new AppError('NOT_FOUND', 'Status not found.');
  await removeStatus(app, doc);
}

/** An admin removes a reported status. Written to the audit log, naming its owner. */
export async function removeStatusAsAdmin(app: FastifyInstance, actor: Actor, id: string) {
  const doc = await statusModels(app).Status.findById(id).lean();
  if (!doc) return false;
  await removeStatus(app, doc);
  await audit(app, actor, 'status.remove', await findTarget(app, doc.userId.toString()));
  return true;
}
