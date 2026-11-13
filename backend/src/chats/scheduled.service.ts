import { randomBytes } from 'node:crypto';
import {
  CAPTION_MAX,
  type CreateScheduledBody,
  SCHEDULE_AHEAD_MAX_DAYS,
  SCHEDULE_MIN_LEAD_SECONDS,
  SCHEDULED_MAX,
  type ScheduledFailure,
  type ScheduledMessage,
} from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import type { Types } from 'mongoose';
import { registerScheduledModels, type ScheduledDoc } from '../db/scheduled-models.ts';
import { AppError } from '../lib/errors.ts';
import { toMediaInfo } from '../media/media.service.ts';
import { chatModels, oid, requireMember } from './chats.service.ts';
import { checkMentions } from './mentions.ts';

export const scheduledModels = (app: FastifyInstance) => registerScheduledModels(app.mongo);

/** Waiting to be sent: what counts toward the limit, and what an upload is kept for. */
export const WAITING = ['pending', 'sending'] as const;
/** What my list shows. */
const LISTED = ['pending', 'sending', 'failed'] as const;
const LIST_MAX = 200;

/** The timers behind scheduled messages. Without Redis these do nothing: the sweep finds them. */
export interface ScheduledJobs {
  schedule(id: string, sendAt: Date): Promise<void>;
  unschedule(id: string, sendAt: Date): Promise<void>;
}

export const noJobs: ScheduledJobs = { schedule: async () => {}, unschedule: async () => {} };

/** A UUIDv7, as clients make them, so the eventual send is de-duplicated like any other. */
export function uuidv7(now = Date.now()): string {
  const time = now.toString(16).padStart(12, '0');
  const random = randomBytes(10).toString('hex');
  const variant = ((Number.parseInt(random.slice(3, 4), 16) & 0x3) | 0x8).toString(16);
  return `${time.slice(0, 8)}-${time.slice(8)}-7${random.slice(0, 3)}-${variant}${random.slice(4, 7)}-${random.slice(7, 19)}`;
}

export function toScheduled(doc: ScheduledDoc): ScheduledMessage {
  return {
    id: doc._id.toString(),
    chatId: doc.chatId.toString(),
    text: doc.text,
    media: doc.media,
    sendAt: doc.sendAt.toISOString(),
    status: doc.status,
    failure: doc.failure,
    messageId: doc.messageId?.toString() ?? null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

/** My devices fetch the list again; `failed` says one could not go. */
export function announceScheduled(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  failed: { id: string; reason: ScheduledFailure } | null = null,
) {
  app.realtime.emitToUser(userId, 'scheduled:updated', { chatId, failed });
}

/** Too soon (or past) means "send it now", not "schedule it"; too far ahead is refused. */
function assertSendAt(value: string, now = Date.now()): Date {
  const sendAt = new Date(value);
  if (sendAt.getTime() - now < SCHEDULE_MIN_LEAD_SECONDS * 1000) {
    throw new AppError('BAD_REQUEST', 'Pick a time in the future.');
  }
  if (sendAt.getTime() - now > SCHEDULE_AHEAD_MAX_DAYS * 86_400_000) {
    throw new AppError(
      'BAD_REQUEST',
      `Messages can be scheduled up to ${SCHEDULE_AHEAD_MAX_DAYS} days ahead.`,
    );
  }
  return sendAt;
}

const waitingCount = (app: FastifyInstance, userId: Types.ObjectId) =>
  scheduledModels(app).Scheduled.countDocuments({ userId, status: { $in: [...WAITING] } });

/** A finished upload of mine, not sent and not waiting in another scheduled message. */
async function scheduledMedia(app: FastifyInstance, userId: string, mediaId: string) {
  const media = await chatModels(app)
    .Media.findOne({ _id: oid(mediaId), ownerId: oid(userId), status: 'ready', messageId: null })
    .lean();
  const taken =
    media &&
    (await scheduledModels(app).Scheduled.exists({
      mediaId: media._id,
      status: { $in: [...WAITING] },
    }));
  if (!media || taken) {
    throw new AppError('MEDIA_NOT_ATTACHABLE', 'This file cannot be attached to a message.');
  }
  return toMediaInfo(media);
}

export async function createScheduled(
  app: FastifyInstance,
  userId: string,
  body: CreateScheduledBody,
  jobs: ScheduledJobs,
): Promise<ScheduledMessage> {
  const sendAt = assertSendAt(body.sendAt);
  const member = await requireMember(app, body.chatId, userId);
  const owner = oid(userId);
  if ((await waitingCount(app, owner)) >= SCHEDULED_MAX) {
    throw new AppError('SCHEDULED_LIMIT_REACHED', `At most ${SCHEDULED_MAX} scheduled messages.`);
  }
  const media = body.mediaId ? await scheduledMedia(app, userId, body.mediaId) : null;
  const text = body.text?.trim() ? body.text : null;
  const checked = await checkMentions(app, member.chatId, member, text, body);
  const { Scheduled } = scheduledModels(app);
  const now = new Date();
  const [doc] = await Scheduled.insertMany([
    {
      userId: owner,
      chatId: member.chatId,
      text,
      mediaId: media ? oid(media.id) : null,
      media,
      ...(checked?.mentions.length ? { mentions: body.mentions } : {}),
      ...(checked?.everyone ? { mentionsEveryone: true } : {}),
      sendAt,
      status: 'pending',
      clientMsgId: uuidv7(now.getTime()),
      createdAt: now,
      updatedAt: now,
    },
  ]);
  if (!doc) throw new AppError('INTERNAL_ERROR', 'Could not schedule the message.');
  // Two at once could both have seen 49: the one that went over takes itself back.
  if ((await waitingCount(app, owner)) > SCHEDULED_MAX) {
    await Scheduled.deleteOne({ _id: doc._id });
    throw new AppError('SCHEDULED_LIMIT_REACHED', `At most ${SCHEDULED_MAX} scheduled messages.`);
  }
  const stored = doc.toObject() as ScheduledDoc;
  await jobs.schedule(stored._id.toString(), sendAt);
  announceScheduled(app, userId, body.chatId);
  return toScheduled(stored);
}

export async function listScheduled(
  app: FastifyInstance,
  userId: string,
  chatId?: string,
): Promise<ScheduledMessage[]> {
  const docs = await scheduledModels(app)
    .Scheduled.find({
      userId: oid(userId),
      status: { $in: [...LISTED] },
      ...(chatId ? { chatId: oid(chatId) } : {}),
    })
    .sort({ sendAt: 1 })
    .limit(LIST_MAX)
    .lean();
  return docs.map(toScheduled);
}

/** Someone else's gets the same answer as one that does not exist. */
export async function ownScheduled(app: FastifyInstance, userId: string, id: string) {
  const doc = await scheduledModels(app)
    .Scheduled.findOne({ _id: oid(id), userId: oid(userId) })
    .lean();
  if (!doc) throw new AppError('NOT_FOUND', 'Scheduled message not found.');
  return doc;
}

/** The new text: a text message cannot become empty, and a caption has its own limit. */
function editedText(doc: ScheduledDoc, input: string) {
  const text = input.trim() ? input : null;
  if (!doc.mediaId && !text) throw new AppError('BAD_REQUEST', 'A message cannot be empty.');
  if (doc.mediaId && (text?.length ?? 0) > CAPTION_MAX) {
    throw new AppError('BAD_REQUEST', 'Caption is too long.');
  }
  return text;
}

/**
 * Text and/or time, only while it is still waiting. New text drops the mentions, whose positions
 * pointed into the old text; "@everyone" stays while the text still says it.
 */
export async function updateScheduled(
  app: FastifyInstance,
  userId: string,
  id: string,
  body: { text?: string | undefined; sendAt?: string | undefined },
  jobs: ScheduledJobs,
): Promise<ScheduledMessage> {
  const doc = await ownScheduled(app, userId, id);
  if (doc.status !== 'pending')
    throw new AppError('CONFLICT', 'This message is no longer waiting.');
  const sendAt = body.sendAt === undefined ? doc.sendAt : assertSendAt(body.sendAt);
  const set: Partial<ScheduledDoc> = { sendAt, updatedAt: new Date() };
  const unset: Record<string, 1> = {};
  if (body.text !== undefined) {
    set.text = editedText(doc, body.text);
    if (set.text !== doc.text) {
      unset.mentions = 1;
      if (!set.text?.includes('@everyone')) unset.mentionsEveryone = 1;
    }
  }
  const updated = await scheduledModels(app)
    .Scheduled.findOneAndUpdate(
      // Still waiting: the runner may have just started sending it.
      { _id: doc._id, status: 'pending' },
      { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) },
      { returnDocument: 'after' },
    )
    .lean();
  if (!updated) throw new AppError('CONFLICT', 'This message is no longer waiting.');
  if (updated.sendAt.getTime() !== doc.sendAt.getTime()) {
    await jobs.unschedule(id, doc.sendAt);
    await jobs.schedule(id, updated.sendAt);
  }
  announceScheduled(app, userId, doc.chatId.toString());
  return toScheduled(updated);
}

/** While waiting, or after it failed. The upload stays mine (the hourly cleanup removes it later). */
export async function deleteScheduled(
  app: FastifyInstance,
  userId: string,
  id: string,
  jobs: ScheduledJobs,
) {
  const doc = await ownScheduled(app, userId, id);
  const removed = await scheduledModels(app).Scheduled.deleteOne({
    _id: doc._id,
    status: { $in: ['pending', 'failed'] },
  });
  if (removed.deletedCount === 0) {
    throw new AppError('CONFLICT', 'This message is being sent or was sent.');
  }
  if (doc.status === 'pending') await jobs.unschedule(id, doc.sendAt);
  announceScheduled(app, userId, doc.chatId.toString());
}
