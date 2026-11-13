import type { FastifyInstance } from 'fastify';
import type { ClientSession, Types } from 'mongoose';
import { usersModel } from '../users/user-record.ts';
import { chatModels } from './chats.service.ts';

/**
 * A new message brings an archived chat back to the list of each member who turned "Keep chats
 * archived" off. Never for the sender: writing in an archived chat leaves it where it is.
 * Returns who got it back, so their devices can be told.
 */
export async function unarchiveForNewMessage(
  app: FastifyInstance,
  session: ClientSession,
  chatId: Types.ObjectId,
  members: Array<{ userId: Types.ObjectId; archivedAt?: Date | null | undefined }>,
  senderId: Types.ObjectId,
): Promise<Set<string>> {
  const archived = members
    .filter((member) => member.archivedAt && !member.userId.equals(senderId))
    .map((member) => member.userId);
  if (archived.length === 0) return new Set();
  // The default is on, so only an explicit "off" counts.
  const letGo = await usersModel(app)
    .find({ _id: { $in: archived }, 'chatSettings.keepChatsArchived': false })
    .select({ _id: 1 })
    .session(session)
    .lean();
  if (letGo.length === 0) return new Set();
  const ids = letGo.map((user) => user._id);
  await chatModels(app).ChatMember.updateMany(
    { chatId, userId: { $in: ids } },
    { $set: { archivedAt: null } },
    { session },
  );
  return new Set(ids.map((id) => id.toString()));
}
