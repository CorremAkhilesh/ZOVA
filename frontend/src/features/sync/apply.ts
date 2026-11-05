import type { ChatSummary, Message, SyncResponse } from '@zuvo/protocol';
import type { ChatRow, LocalDb, MessageRow } from './local-db';

const CURSOR = 'cursor';

/**
 * - applied: stored, and the cursor moved if this was the next change
 * - stale: this device already has it
 * - gap: something is missing (a skipped number or an unknown chat), so call sync instead
 */
export type ApplyResult = 'applied' | 'stale' | 'gap';

/** Keyed by sender + clientMsgId (unique per sender only), or the server id without one. */
export function messageKey(message: Pick<Message, 'id' | 'senderId' | 'clientMsgId'>): string {
  return message.senderId && message.clientMsgId
    ? `${message.senderId}:${message.clientMsgId}`
    : message.id;
}

export const toMessageRow = (message: Message): MessageRow => ({
  ...message,
  key: messageKey(message),
  order: message.seq,
  status: 'sent',
});

const sortAtOf = (chat: Pick<ChatSummary, 'lastActivityAt' | 'createdAt'>) =>
  Date.parse(chat.lastActivityAt ?? chat.createdAt);

export const toChatRow = (chat: ChatSummary): ChatRow => ({ ...chat, sortAt: sortAtOf(chat) });

type ChatChange = {
  [Field in
    | 'seq'
    | 'lastMessage'
    | 'lastActivityAt'
    | 'otherUser'
    | 'createdAt'
    | 'lastReadSeq'
    | 'peerDeliveredSeq'
    | 'peerReadSeq']?: ChatSummary[Field] | undefined;
};

/** Null means read receipts are off for this chat: nothing already seen stays "read". */
function mergePeerRead(row: ChatRow, change: ChatChange): number | null {
  if (change.peerReadSeq === undefined) return row.peerReadSeq ?? null;
  if (change.peerReadSeq === null) return null;
  return Math.max(row.peerReadSeq ?? 0, change.peerReadSeq);
}

/** Positions only move forward, so older news arriving late can never undo newer state. */
export function mergeChat(row: ChatRow, change: ChatChange): ChatRow {
  const seq = Math.max(row.seq, change.seq ?? row.seq);
  const lastReadSeq = Math.max(row.lastReadSeq, change.lastReadSeq ?? row.lastReadSeq);
  const current = change.seq !== undefined && change.seq >= row.seq;
  const lastActivityAt =
    change.lastActivityAt &&
    (!row.lastActivityAt || Date.parse(change.lastActivityAt) >= Date.parse(row.lastActivityAt))
      ? change.lastActivityAt
      : row.lastActivityAt;
  const merged: ChatRow = {
    ...row,
    seq,
    lastReadSeq,
    unreadCount: Math.max(0, seq - lastReadSeq),
    peerDeliveredSeq: Math.max(row.peerDeliveredSeq ?? 0, change.peerDeliveredSeq ?? 0),
    peerReadSeq: mergePeerRead(row, change),
    lastMessage: current ? (change.lastMessage ?? row.lastMessage) : row.lastMessage,
    lastActivityAt,
    otherUser: change.otherUser === undefined ? row.otherUser : change.otherUser,
  };
  return { ...merged, sortAt: Math.max(row.sortAt, sortAtOf(merged)) };
}

const allStores = (db: LocalDb) => [db.chats, db.profiles, db.messages, db.outbox, db.meta];

export async function readCursor(db: LocalDb): Promise<string | undefined> {
  return (await db.meta.get(CURSOR))?.value;
}

/** The server has this message, so it must never be sent again. */
async function settleOutbox(db: LocalDb, messages: Message[]) {
  const ids = messages.flatMap((message) => (message.clientMsgId ? [message.clientMsgId] : []));
  if (ids.length > 0) await db.outbox.where('clientMsgId').anyOf(ids).delete();
}

async function storeMessages(db: LocalDb, me: string, messages: Message[]) {
  await db.messages.bulkPut(messages.map(toMessageRow));
  await settleOutbox(
    db,
    messages.filter((message) => message.senderId === me),
  );
}

async function storeChats(db: LocalDb, chats: ChatSummary[]) {
  const existing = await db.chats.bulkGet(chats.map((chat) => chat.id));
  await db.chats.bulkPut(
    chats.map((chat, index) => {
      const row = existing[index];
      return row ? mergeChat(row, chat) : toChatRow(chat);
    }),
  );
  await db.profiles.bulkPut(chats.flatMap((chat) => (chat.otherUser ? [chat.otherUser] : [])));
}

/** Decides what a numbered live event means: next, already seen, or proof of a gap. */
function classify(local: string | undefined, cursor: string) {
  if (local === undefined) return 'gap' as const;
  const difference = Number(cursor) - Number(local);
  if (difference > 1) return 'gap' as const;
  return difference === 1 ? ('next' as const) : ('seen' as const);
}

async function advance(db: LocalDb, cursor: string) {
  await db.meta.put({ key: CURSOR, value: cursor });
}

export function applyLiveMessage(
  db: LocalDb,
  me: string,
  message: Message,
  cursor: string,
): Promise<ApplyResult> {
  return db.transaction('rw', allStores(db), async () => {
    const position = classify(await readCursor(db), cursor);
    if (position === 'gap') return 'gap';
    if (position === 'seen') return 'stale';
    // A first message in a chat this device has never seen: sync brings the chat with it.
    if (!(await db.chats.get(message.chatId))) return 'gap';
    await storeMessages(db, me, [message]);
    await advance(db, cursor);
    return 'applied';
  });
}

/**
 * chat:updated and read:update share a number with the event before them, so an already-seen number
 * still applies: merging is safe to repeat. Only a skipped number means something is missing.
 */
export function applyLiveChatChange(
  db: LocalDb,
  chatId: string,
  change: ChatChange,
  cursor: string,
): Promise<ApplyResult> {
  return db.transaction('rw', allStores(db), async () => {
    const position = classify(await readCursor(db), cursor);
    if (position === 'gap') return 'gap';
    const row = await db.chats.get(chatId);
    if (!row) return 'gap';
    await db.chats.put(mergeChat(row, change));
    if (position === 'next') await advance(db, cursor);
    return 'applied';
  });
}

/** One page of GET /v1/sync. Safe to repeat: every write is keyed or only moves forward. */
export function applySyncPage(db: LocalDb, me: string, page: SyncResponse): Promise<void> {
  return db.transaction('rw', allStores(db), async () => {
    await storeChats(db, page.chats);
    await storeMessages(db, me, page.messages);
    const local = await readCursor(db);
    if (local === undefined || Number(page.cursor) > Number(local)) {
      await advance(db, page.cursor);
    }
  });
}

/**
 * This device could not catch up from the log. Replaces chats and confirmed messages, and keeps what
 * is still waiting to be sent. Opening a chat loads its history again.
 */
export function applyReset(db: LocalDb, chats: ChatSummary[], cursor: string): Promise<void> {
  return db.transaction('rw', allStores(db), async () => {
    await db.chats.clear();
    await db.messages.filter((row) => row.status === 'sent').delete();
    await storeChats(db, chats);
    await advance(db, cursor);
  });
}

/** Older messages from REST. Positions never clash: the same message keeps the same key. */
export function applyHistory(db: LocalDb, me: string, messages: Message[]): Promise<void> {
  return db.transaction('rw', allStores(db), () => storeMessages(db, me, messages));
}

/** Chats fetched directly: a new chat, a deep link, or refreshed names and photos. */
export function applyChats(db: LocalDb, chats: ChatSummary[]): Promise<void> {
  return db.transaction('rw', allStores(db), () => storeChats(db, chats));
}

/** The answer to my own read:update. It carries no cursor; the event that follows moves it. */
export function applyReadAck(db: LocalDb, chatId: string, lastReadSeq: number): Promise<void> {
  return db.transaction('rw', allStores(db), async () => {
    const row = await db.chats.get(chatId);
    if (row) await db.chats.put(mergeChat(row, { lastReadSeq }));
  });
}
