import type { FastifyInstance } from 'fastify';
import type { ClientSession } from 'mongoose';
import { chatModels, oid } from '../chats/chats.service.ts';
import type { MediaDoc } from '../db/chat-models.ts';
import { AppError } from '../lib/errors.ts';

/**
 * A file of mine, already uploaded, sent again by reference ("Share to Zuvo": one upload, several
 * chats; like a forward, the file stays until no message refers to it). Mine and ready only, and
 * never a view-once file. If no message holds it yet (its first message failed), this one does, so
 * the orphan cleanup cannot take it.
 */
export async function shareOwnMedia(
  app: FastifyInstance,
  session: ClientSession,
  input: { mediaId: string; userId: string; chatId: string; messageId: MediaDoc['messageId'] },
): Promise<MediaDoc> {
  const { Media, Message } = chatModels(app);
  const doc = await Media.findOne({
    _id: oid(input.mediaId),
    ownerId: oid(input.userId),
    status: 'ready',
  })
    .session(session)
    .lean();
  // Index: media.id.
  const viewOnce = doc && (await Message.exists({ 'media.id': input.mediaId, viewOnce: true }));
  if (!doc || viewOnce) {
    throw new AppError('MEDIA_NOT_ATTACHABLE', 'This file cannot be attached to a message.');
  }
  if (doc.messageId === null) {
    await Media.updateOne(
      { _id: doc._id, messageId: null },
      { $set: { messageId: input.messageId, chatId: oid(input.chatId) } },
      { session },
    );
  }
  return doc;
}
