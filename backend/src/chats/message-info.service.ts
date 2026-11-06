import type { MessageInfo } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../lib/errors.ts';
import { toPublicProfile, type UserDoc, usersModel } from '../users/user-record.ts';
import { chatModels, oid, requireMember } from './chats.service.ts';
import { ownReceiptsOn } from './group-receipts.service.ts';

/** The most events read for one message: the first per person and kind are at the front. */
const EVENTS_MAX = 2000;

/**
 * Who has my message, and when. Only the sender may ask. Someone with read receipts off, or anyone at
 * all while mine are off, shows as delivered: privacy decided at the moment, as everywhere else.
 */
export async function messageInfo(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  messageId: string,
): Promise<MessageInfo> {
  await requireMember(app, chatId, userId);
  const { Message, ChatMember, ReceiptEvent } = chatModels(app);
  const chat = oid(chatId);
  const message = await Message.findOne({ _id: oid(messageId), chatId: chat }).lean();
  if (!message) throw new AppError('NOT_FOUND', 'Message not found.');
  if (message.senderId?.toString() !== userId) {
    throw new AppError('FORBIDDEN', 'Only the sender can see this.');
  }
  const { seq } = message;
  const members = await ChatMember.find({
    chatId: chat,
    leftAt: null,
    userId: { $ne: oid(userId) },
  }).lean();
  // Someone who joined later was never meant to get it.
  const audience = members.filter((member) => (member.joinSeq ?? 0) < seq);
  const events = await ReceiptEvent.find({ chatId: chat, seq: { $gte: seq } })
    .sort({ seq: 1 })
    .limit(EVENTS_MAX)
    .lean();
  const firstAt = new Map<string, Date>();
  for (const event of events) {
    const key = `${event.kind}:${event.userId.toString()}`;
    if (!firstAt.has(key)) firstAt.set(key, event.at);
  }
  const users = (await usersModel(app)
    .find({ _id: { $in: audience.map((member) => member.userId) } })
    .lean()) as UserDoc[];
  const byId = new Map(users.map((user) => [user._id.toString(), user]));
  const myReceipts = await ownReceiptsOn(app, userId);

  const info: MessageInfo = { readBy: [], deliveredTo: [], waiting: 0 };
  for (const member of audience) {
    const id = member.userId.toString();
    const user = byId.get(id);
    if (!user) continue;
    const entry = (kind: 'read' | 'delivered') => ({
      user: toPublicProfile(user, userId),
      at: firstAt.get(`${kind}:${id}`)?.toISOString() ?? null,
    });
    const read = myReceipts && (member.sharedReadSeq ?? 0) >= seq;
    if (read) info.readBy.push(entry('read'));
    else if (member.lastDeliveredSeq >= seq) info.deliveredTo.push(entry('delivered'));
    else info.waiting += 1;
  }
  return info;
}
