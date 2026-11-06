import type { FastifyInstance } from 'fastify';
import { privacyOf, type UserDoc, usersModel } from '../users/user-record.ts';
import { chatModels, oid } from './chats.service.ts';
import { logUpdates } from './updates.ts';

export async function ownReceiptsOn(app: FastifyInstance, userId: string): Promise<boolean> {
  const user = (await usersModel(app)
    .findById(userId)
    .select({ privacy: 1 })
    .lean()) as UserDoc | null;
  return user ? privacyOf(user).readReceipts : false;
}

/**
 * How far everyone in a group has got: a message of mine gets two ticks at the delivered mark, and
 * color at the read mark. Someone with read receipts off counts as far as they have received. The sender
 * of a message is always past it, so one mark per chat serves every sender.
 *
 * Marks only ever go up. When one does, every member hears once, which is about once per message
 * however many people each report it, rather than for every one of them.
 */
export async function refreshGroupMarks(app: FastifyInstance, chatId: string): Promise<void> {
  const models = chatModels(app);
  const { Chat, ChatMember } = models;
  const id = oid(chatId);
  const active = { chatId: id, leftAt: null, suspended: { $ne: true } };
  const [delivered, read, chat] = await Promise.all([
    ChatMember.findOne(active).sort({ lastDeliveredSeq: 1 }).select({ lastDeliveredSeq: 1 }).lean(),
    ChatMember.findOne(active).sort({ ackReadSeq: 1 }).select({ ackReadSeq: 1 }).lean(),
    Chat.findById(id).select({ group: 1, type: 1 }).lean(),
  ]);
  if (chat?.type !== 'group' || !delivered || !read) return;
  const deliveredMark = delivered.lastDeliveredSeq;
  const readMark = read.ackReadSeq ?? 0;
  if (
    deliveredMark <= (chat.group?.deliveredMark ?? 0) &&
    readMark <= (chat.group?.readMark ?? 0)
  ) {
    return;
  }
  const told = await app.mongo.transaction(async (session) => {
    await Chat.updateOne(
      { _id: id },
      { $max: { 'group.deliveredMark': deliveredMark, 'group.readMark': readMark } },
      { session },
    );
    const members = await ChatMember.find({ chatId: id, leftAt: null })
      .select({ userId: 1 })
      .session(session)
      .lean();
    return logUpdates(
      models,
      session,
      members.map((member) => member.userId),
      { kind: 'receipt', chatId: id },
      new Date(),
    );
  });
  // Reciprocal, as in direct chats: with receipts off, you see no reads either.
  const users = (await usersModel(app)
    .find({ _id: { $in: [...told.keys()].map(oid) } })
    .select({ privacy: 1 })
    .lean()) as UserDoc[];
  const hidden = new Set(
    users.filter((user) => !privacyOf(user).readReceipts).map((user) => user._id.toString()),
  );
  for (const [viewerId, cursor] of told) {
    app.realtime.emitToUser(viewerId, 'receipt:update', {
      chatId,
      userId: viewerId,
      lastDeliveredSeq: deliveredMark,
      lastReadSeq: hidden.has(viewerId) ? 0 : readMark,
      cursor,
    });
  }
}
