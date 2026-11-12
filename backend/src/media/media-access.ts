import type { FastifyInstance } from 'fastify';
import { chatModels, oid } from '../chats/chats.service.ts';
import { canSeeSeq } from '../chats/visibility.ts';
import type { MediaDoc } from '../db/chat-models.ts';
import { AppError } from '../lib/errors.ts';
import { destroyMedia } from './media.service.ts';

/**
 * The uploader, or anyone who can see a message using this file. A forwarded file has one record and
 * many messages, in chats the uploader may not even be in. Others cannot tell it exists.
 */
export async function requireReadable(
  app: FastifyInstance,
  id: string,
  userId: string,
): Promise<MediaDoc> {
  const doc = await chatModels(app).Media.findById(id).lean();
  if (!doc) throw new AppError('NOT_FOUND', 'Media not found.');
  if (doc.ownerId.toString() !== userId) await requireUsedWhereVisible(app, id, userId);
  // Not even the sender: their own device keeps its copy, and nobody else gets a lasting link.
  if (await isViewOnceMedia(app, id)) {
    throw new AppError('FORBIDDEN', 'View-once media opens only from its message.');
  }
  return doc;
}

/** Whether a view-once message uses this file. Index: media.id. */
export async function isViewOnceMedia(app: FastifyInstance, id: string): Promise<boolean> {
  return Boolean(await chatModels(app).Message.exists({ 'media.id': id, viewOnce: true }));
}

async function requireUsedWhereVisible(app: FastifyInstance, id: string, userId: string) {
  const { Message, ChatMember } = chatModels(app);
  const uses = await Message.find({ 'media.id': id }).select({ chatId: 1, seq: 1 }).lean();
  const members = await ChatMember.find({
    userId: oid(userId),
    chatId: { $in: uses.map((use) => use.chatId) },
  }).lean();
  const memberOf = new Map(members.map((member) => [member.chatId.toString(), member]));
  const allowed = uses.some((use) => {
    const member = memberOf.get(use.chatId.toString());
    return member && canSeeSeq(member, use.seq);
  });
  if (!allowed) throw new AppError('NOT_FOUND', 'Media not found.');
}

/**
 * Files whose message was deleted for everyone, or expired. A forwarded copy elsewhere keeps the
 * file, until that one goes too, which asks again. A view-once file is asked for a little ahead (its
 * opener's link must still work): `deleteRequestedAt` is then in the future, and it waits until then.
 */
export async function cleanupDeletedMedia(
  app: FastifyInstance,
  batch = 200,
  now: Date = new Date(),
): Promise<number> {
  const { Media, Message } = chatModels(app);
  const candidates = await Media.find({ deleteRequestedAt: { $type: 'date', $lte: now } })
    .limit(batch)
    .lean();
  let removed = 0;
  for (const doc of candidates) {
    // A view-once message that everyone opened (or that ran out of time) no longer needs its file.
    const stillUsed = await Message.exists({
      'media.id': doc._id.toString(),
      viewOnceDoneAt: { $not: { $type: 'date' } },
    });
    if (stillUsed) {
      await Media.updateOne({ _id: doc._id }, { $unset: { deleteRequestedAt: 1 } });
    } else {
      await destroyMedia(app, doc);
      removed += 1;
    }
  }
  return removed;
}
