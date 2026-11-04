import type { SyncResponse } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import type { Types } from 'mongoose';
import { buildSummaries, chatModels, oid } from './chats.service.ts';
import { toMessage } from './message-format.ts';

async function currentCursor(app: FastifyInstance, userId: string): Promise<string> {
  const counter = await chatModels(app).UserSync.findById(oid(userId)).lean();
  return String(counter?.seq ?? 0);
}

/**
 * Everything that changed for this user after `since`. See docs/protocol.md.
 *
 * Numbers are contiguous per user, so the next change must be exactly `since + 1`. Anything else
 * (no cursor, a cursor from the future, or log rows that expired) means this device cannot catch
 * up from the log: it gets `reset` and reloads its chat list instead.
 */
export async function syncSince(
  app: FastifyInstance,
  userId: string,
  since: string | undefined,
  limit: number,
): Promise<SyncResponse> {
  const { ChatMember, Message, UserUpdate } = chatModels(app);
  const reset = async (): Promise<SyncResponse> => ({
    cursor: await currentCursor(app, userId),
    reset: true,
    hasMore: false,
    chats: [],
    messages: [],
  });
  if (since === undefined) return reset();

  const sincePts = Number(since);
  const rows = await UserUpdate.find({ userId: oid(userId), pts: { $gt: sincePts } })
    .sort({ pts: 1 })
    .limit(limit + 1)
    .lean();
  const first = rows[0];
  if (!first) {
    return sincePts > Number(await currentCursor(app, userId))
      ? reset()
      : { cursor: since, reset: false, hasMore: false, chats: [], messages: [] };
  }
  if (first.pts !== sincePts + 1) return reset();

  const page = rows.slice(0, limit);
  const lastPts = page.at(-1)?.pts ?? sincePts;
  const chatIds = [...new Map(page.map((row) => [row.chatId.toString(), row.chatId])).values()];
  // Only chats I am still in: membership is checked here too, not just when the row was written.
  const members = await ChatMember.find({
    userId: oid(userId),
    leftAt: null,
    chatId: { $in: chatIds },
  }).lean();
  const memberChats = new Set(members.map((member) => member.chatId.toString()));

  const seqsByChat = new Map<string, { chatId: Types.ObjectId; seqs: number[] }>();
  for (const row of page) {
    const key = row.chatId.toString();
    if (row.kind !== 'message' || row.seq === undefined || !memberChats.has(key)) continue;
    const entry = seqsByChat.get(key) ?? { chatId: row.chatId, seqs: [] };
    entry.seqs.push(row.seq);
    seqsByChat.set(key, entry);
  }
  const messageDocs = seqsByChat.size
    ? await Message.find({
        $or: [...seqsByChat.values()].map(({ chatId, seqs }) => ({ chatId, seq: { $in: seqs } })),
      }).lean()
    : [];
  const docByKey = new Map(messageDocs.map((doc) => [`${doc.chatId}:${doc.seq}`, doc]));
  const messages = page.flatMap((row) => {
    const doc = row.kind === 'message' ? docByKey.get(`${row.chatId}:${row.seq}`) : undefined;
    return doc ? [toMessage(doc)] : [];
  });

  return {
    cursor: String(lastPts),
    reset: false,
    hasMore: rows.length > limit,
    chats: await buildSummaries(app, userId, members),
    messages,
  };
}
