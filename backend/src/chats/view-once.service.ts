import { MEDIA_LINK_TTL_SECONDS, VIEW_ONCE_TTL_DAYS } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import type { ClientSession } from 'mongoose';
import type { MessageDoc } from '../db/chat-models.ts';
import { AppError } from '../lib/errors.ts';
import { mediaLink } from '../media/media-links.ts';
import { chatModels, oid } from './chats.service.ts';
import {
  announceMessageUpdate,
  logMessageUpdate,
  type PendingAnnouncement,
  requireVisibleMessage,
} from './message-updates.ts';
import { canSeeSeq } from './visibility.ts';

export const VIEW_ONCE_BATCH = 100;

const openedBy = (doc: MessageDoc, userId: string) =>
  (doc.viewOnceOpenedBy ?? []).some((id) => id.toString() === userId);

/**
 * Whether someone who may open it still has not: active members other than the sender who could see
 * it (joined before it), and who have not deleted it for themselves or been deactivated.
 */
async function someoneWaiting(app: FastifyInstance, session: ClientSession, doc: MessageDoc) {
  const { ChatMember, MessageHidden } = chatModels(app);
  const members = await ChatMember.find({ chatId: doc.chatId, leftAt: null })
    .session(session)
    .lean();
  const hidden = await MessageHidden.find({ chatId: doc.chatId, messageId: doc._id })
    .select({ userId: 1 })
    .session(session)
    .lean();
  const hiddenBy = new Set(hidden.map((row) => row.userId.toString()));
  return members.some((member) => {
    const id = member.userId.toString();
    return (
      !doc.senderId?.equals(member.userId) &&
      !member.suspended &&
      canSeeSeq(member, doc.seq) &&
      !hiddenBy.has(id) &&
      !openedBy(doc, id)
    );
  });
}

/**
 * Done: nobody else will open it. The file is asked to go once the last link handed out has expired,
 * so whoever just opened it can still load it; the media cleanup then deletes it.
 */
async function finish(app: FastifyInstance, session: ClientSession, doc: MessageDoc, now: Date) {
  const { Message, Media } = chatModels(app);
  const changed = await Message.updateOne(
    { _id: doc._id, viewOnceDoneAt: null },
    { $set: { viewOnceDoneAt: now } },
    { session },
  );
  if (changed.modifiedCount === 0) return null;
  if (doc.media?.id) {
    await Media.updateOne(
      { _id: oid(doc.media.id) },
      { $set: { deleteRequestedAt: new Date(now.getTime() + MEDIA_LINK_TTL_SECONDS * 1000) } },
      { session },
    );
  }
  return logMessageUpdate(app, session, { ...doc, viewOnceDoneAt: now });
}

/**
 * POST /v1/chats/:id/messages/:messageId/view-once. Counts as opened at once, and only once: the
 * conditional update means two tabs cannot both get the link. Returns the one link to the file.
 */
export async function openViewOnce(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  messageId: string,
) {
  const { doc } = await requireVisibleMessage(app, userId, chatId, messageId);
  if (doc.deletedForEveryoneAt) throw new AppError('NOT_FOUND', 'Message not found.');
  if (!doc.viewOnce || !doc.media) {
    throw new AppError('BAD_REQUEST', 'This message is not a view-once photo or video.');
  }
  if (doc.senderId?.toString() === userId) {
    throw new AppError('FORBIDDEN', 'Only the people you sent it to can open it.');
  }
  const media = doc.media;
  if (doc.viewOnceDoneAt || openedBy(doc, userId)) {
    throw new AppError('VIEW_ONCE_OPENED', 'You have already opened this.');
  }
  const me = oid(userId);
  const now = new Date();
  const pending = await app.mongo.transaction(async (session) => {
    const opened = await chatModels(app)
      .Message.findOneAndUpdate(
        { _id: doc._id, viewOnce: true, viewOnceDoneAt: null, viewOnceOpenedBy: { $ne: me } },
        { $addToSet: { viewOnceOpenedBy: me } },
        { returnDocument: 'after', session },
      )
      .lean();
    if (!opened) return null;
    if (await someoneWaiting(app, session, opened)) {
      return logMessageUpdate(app, session, opened, { only: me });
    }
    // The last one: everyone, the sender included, now sees it as opened.
    return (
      (await finish(app, session, opened, now)) ??
      logMessageUpdate(app, session, opened, { only: me })
    );
  });
  if (!pending) throw new AppError('VIEW_ONCE_OPENED', 'You have already opened this.');
  announceMessageUpdate(app, pending);
  return mediaLink(app.env.AUTH_SECRET, media.id, { once: true }, now.getTime());
}

/** Unopened view-once messages past their time, oldest first. Index: view_once_waiting (partial). */
export const staleViewOnceQuery = (app: FastifyInstance, now: Date, batch = VIEW_ONCE_BATCH) =>
  chatModels(app)
    .Message.find({
      viewOnce: true,
      viewOnceDoneAt: null,
      createdAt: { $lte: new Date(now.getTime() - VIEW_ONCE_TTL_DAYS * 86_400_000) },
    })
    .sort({ createdAt: 1 })
    .limit(batch);

/** View once that not everyone opened within VIEW_ONCE_TTL_DAYS: done, and the file goes. */
export async function expireStaleViewOnce(
  app: FastifyInstance,
  now: Date = new Date(),
  batch = VIEW_ONCE_BATCH,
): Promise<number> {
  const stale = await staleViewOnceQuery(app, now, batch).lean();
  let done = 0;
  for (const doc of stale) {
    const pending: PendingAnnouncement | null = await app.mongo.transaction((session) =>
      finish(app, session, doc, now),
    );
    if (!pending) continue;
    done += 1;
    announceMessageUpdate(app, pending);
  }
  return done;
}
