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
  const { Media, Message, ChatMember } = chatModels(app);
  const doc = await Media.findById(id).lean();
  if (!doc) throw new AppError('NOT_FOUND', 'Media not found.');
  if (doc.ownerId.toString() === userId) return doc;
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
  return doc;
}

/**
 * Files whose message was deleted for everyone. A forwarded copy elsewhere keeps the file, until that
 * one goes too, which asks again.
 */
export async function cleanupDeletedMedia(app: FastifyInstance, batch = 200): Promise<number> {
  const { Media, Message } = chatModels(app);
  const candidates = await Media.find({ deleteRequestedAt: { $type: 'date' } })
    .limit(batch)
    .lean();
  let removed = 0;
  for (const doc of candidates) {
    const stillUsed = await Message.exists({ 'media.id': doc._id.toString() });
    if (stillUsed) {
      await Media.updateOne({ _id: doc._id }, { $unset: { deleteRequestedAt: 1 } });
    } else {
      await destroyMedia(app, doc);
      removed += 1;
    }
  }
  return removed;
}
