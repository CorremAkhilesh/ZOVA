import type { Message, SyncResponse } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import type { Types } from 'mongoose';
import type { ChatMemberDoc, MessageDoc, UserUpdateDoc } from '../db/chat-models.ts';
import { buildSummaries, chatModels, oid } from './chats.service.ts';
import { withStars } from './history.service.ts';
import { hideQuote, toMessage } from './message-format.ts';
import { canSeeSeq } from './visibility.ts';

/** A new message, or one whose `played` changed: either way, this device needs its latest copy. */
const carriesMessage = (row: { kind: string }) =>
  row.kind === 'message' || row.kind === 'played' || row.kind === 'updated';

type UpdateRow = Pick<UserUpdateDoc, 'kind' | 'chatId' | 'seq'>;

async function hiddenAmong(
  app: FastifyInstance,
  userId: string,
  chatIds: Types.ObjectId[],
  docs: MessageDoc[],
) {
  if (docs.length === 0) return new Set<string>();
  const rows = await chatModels(app)
    .MessageHidden.find({
      userId: oid(userId),
      chatId: { $in: chatIds },
      messageId: { $in: docs.map((doc) => doc._id) },
    })
    .select({ messageId: 1 })
    .lean();
  return new Set(rows.map((row) => row.messageId.toString()));
}

/** New to this device, or changes to what it may have. A message changed several times goes once. */
function sortMessages(
  page: UpdateRow[],
  docByKey: Map<string, MessageDoc>,
  memberByChat: Map<string, ChatMemberDoc>,
  hidden: Set<string>,
  userId: string,
) {
  const sent = new Set<string>();
  const messages: Message[] = [];
  const updated: Message[] = [];
  for (const row of page) {
    const doc = carriesMessage(row) ? docByKey.get(`${row.chatId}:${row.seq}`) : undefined;
    const member = memberByChat.get(row.chatId.toString());
    if (!doc || !member || !canSeeSeq(member, doc.seq)) continue;
    const id = doc._id.toString();
    if (hidden.has(id) || sent.has(id)) continue;
    sent.add(id);
    (row.kind === 'updated' ? updated : messages).push(hideQuote(toMessage(doc, userId), member));
  }
  return { messages, updated };
}

function removalsIn(page: UpdateRow[]) {
  const removed: SyncResponse['removed'] = [];
  const cleared: SyncResponse['cleared'] = [];
  for (const { kind, chatId, seq } of page) {
    if (seq === undefined) continue;
    if (kind === 'hidden') removed.push({ chatId: chatId.toString(), seq });
    if (kind === 'cleared' || kind === 'chat_removed') {
      cleared.push({ chatId: chatId.toString(), seq, removeChat: kind === 'chat_removed' });
    }
  }
  return { removed, cleared };
}

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
    updated: [],
    removed: [],
    cleared: [],
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
      : {
          cursor: since,
          reset: false,
          hasMore: false,
          chats: [],
          messages: [],
          updated: [],
          removed: [],
          cleared: [],
        };
  }
  if (first.pts !== sincePts + 1) return reset();

  const page = rows.slice(0, limit);
  const lastPts = page.at(-1)?.pts ?? sincePts;
  const chatIds = [...new Map(page.map((row) => [row.chatId.toString(), row.chatId])).values()];
  // Only chats I am or was in, and only what I may see of them. Checked here as well as when the
  // row was written.
  const memberRows = await ChatMember.find({
    userId: oid(userId),
    chatId: { $in: chatIds },
  }).lean();
  // Left, with no record of when: nothing is known to be theirs, so nothing goes out.
  const members = memberRows.filter((row) => !row.leftAt || typeof row.leftSeq === 'number');
  const memberChats = new Set(members.map((member) => member.chatId.toString()));
  const memberByChat = new Map(members.map((member) => [member.chatId.toString(), member]));

  const seqsByChat = new Map<string, { chatId: Types.ObjectId; seqs: number[] }>();
  for (const row of page) {
    const key = row.chatId.toString();
    if (!carriesMessage(row) || row.seq === undefined || !memberChats.has(key)) continue;
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
  const hidden = await hiddenAmong(app, userId, chatIds, messageDocs);
  const { messages, updated } = sortMessages(page, docByKey, memberByChat, hidden, userId);
  const { removed, cleared } = removalsIn(page);

  return {
    cursor: String(lastPts),
    reset: false,
    hasMore: rows.length > limit,
    // A chat I deleted stays out of my list, until someone writes again.
    chats: await buildSummaries(
      app,
      userId,
      members.filter((member) => member.lastActivityAt !== null),
    ),
    messages: await withStars(app, userId, messages),
    updated: await withStars(app, userId, updated),
    removed,
    cleared,
  };
}
