import type { ChatType } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { chatModels } from '../chats/chats.service.ts';
import type { MessageDoc } from '../db/chat-models.ts';
import { toPublicProfile, type UserDoc, usersModel } from '../users/user-record.ts';

/**
 * Names for a page of search results: each chat's title and each sender's name, as this person
 * may see them. One query per kind, whatever the page holds.
 */
export async function searchTitles(app: FastifyInstance, viewerId: string, docs: MessageDoc[]) {
  const { Chat, ChatMember } = chatModels(app);
  const chatIds = [...new Set(docs.map((doc) => doc.chatId.toString()))].map(
    (id) => new Types.ObjectId(id),
  );
  const chats = await Chat.find({ _id: { $in: chatIds } })
    .select({ type: 1, group: 1 })
    .lean();
  const directIds = chats.filter((chat) => chat.type === 'direct').map((chat) => chat._id);
  const others = directIds.length
    ? await ChatMember.find({
        chatId: { $in: directIds },
        userId: { $ne: new Types.ObjectId(viewerId) },
      })
        .select({ chatId: 1, userId: 1 })
        .lean()
    : [];
  const userIds = new Set([
    ...docs.flatMap((doc) => (doc.senderId ? [doc.senderId.toString()] : [])),
    ...others.map((other) => other.userId.toString()),
  ]);
  const users = (await usersModel(app)
    .find({ _id: { $in: [...userIds].map((id) => new Types.ObjectId(id)) } })
    .lean()) as UserDoc[];
  const nameOf = new Map(
    users.map((user) => [user._id.toString(), toPublicProfile(user, viewerId).displayName]),
  );
  const otherOf = new Map(
    others.map((other) => [other.chatId.toString(), other.userId.toString()]),
  );
  const chatById = new Map(chats.map((chat) => [chat._id.toString(), chat]));

  return {
    chat(chatId: string): { id: string; type: ChatType; title: string | null } {
      const chat = chatById.get(chatId);
      const type: ChatType = chat?.type ?? 'direct';
      if (type === 'group') return { id: chatId, type, title: chat?.group?.name ?? null };
      if (type === 'self') return { id: chatId, type, title: null };
      const other = otherOf.get(chatId);
      return { id: chatId, type, title: other ? (nameOf.get(other) ?? null) : null };
    },
    person: (userId: string) => nameOf.get(userId) ?? null,
  };
}
