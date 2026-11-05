import type { ChatSummary, Message, PublicProfile } from '@zuvo/protocol';
import Dexie, { type Table } from 'dexie';

/** Messages not yet accepted by the server sort after every real position. */
export const PENDING_ORDER_BASE = 1e12;

export type MessageStatus = 'pending' | 'failed' | 'sent';

export interface MessageRow extends Omit<Message, 'id' | 'seq'> {
  /** Stable across send and ack, so re-applying a message can never duplicate it. */
  key: string;
  /** Null until the server accepts the message. */
  id: string | null;
  seq: number | null;
  /** `seq`, or PENDING_ORDER_BASE + the outbox number while unsent. */
  order: number;
  status: MessageStatus;
}

export interface ChatRow extends ChatSummary {
  /** Last activity (or creation) in ms: the chat list's sort order. */
  sortAt: number;
  /** How far this device has told the server it received. Local only. */
  ackedDeliveredSeq?: number;
}

export interface OutboxRow {
  /** Sending order. */
  n?: number;
  clientMsgId: string;
  chatId: string;
  text: string;
  attempts: number;
  state: 'pending' | 'failed';
  /** When it was queued or retried, in ms. Rows from before this field count as long overdue. */
  queuedAt?: number;
}

export interface MetaRow {
  key: string;
  value: string;
}

export interface DraftRow {
  chatId: string;
  text: string;
}

export class LocalDb extends Dexie {
  chats!: Table<ChatRow, string>;
  profiles!: Table<PublicProfile, string>;
  messages!: Table<MessageRow, string>;
  outbox!: Table<OutboxRow, number>;
  meta!: Table<MetaRow, string>;
  drafts!: Table<DraftRow, string>;

  constructor(name: string) {
    // No query cache: it merges writes into stored results instead of re-reading, and a read still
    // in flight during a write could replace the result with an older one, hiding messages.
    super(name, { cache: 'disabled' });
    this.version(1).stores({
      chats: 'id, sortAt',
      profiles: 'id',
      messages: 'key, [chatId+order]',
      outbox: '++n, &clientMsgId, state',
      meta: 'key',
      drafts: 'chatId',
    });
  }
}

const DB_PREFIX = 'zuvo-user-';
/** A browser can leave a delete blocked by another tab; sign-out must not hang on that. */
const WIPE_TIMEOUT_MS = 3000;
const open = new Map<string, LocalDb>();

/** One database per signed-in user, so two people on one browser never mix. */
export function getUserDb(userId: string): LocalDb {
  const existing = open.get(userId);
  if (existing && !existing.hasBeenClosed()) return existing;
  const db = new LocalDb(`${DB_PREFIX}${userId}`);
  open.set(userId, db);
  return db;
}

/** Deletes every user's local chats, messages, outbox and drafts on this browser. */
export async function wipeLocalDatabases(): Promise<void> {
  for (const db of open.values()) db.close();
  open.clear();
  const names = await Dexie.getDatabaseNames();
  const deleting = Promise.all(
    names.filter((name) => name.startsWith(DB_PREFIX)).map((name) => Dexie.delete(name)),
  );
  await Promise.race([deleting, new Promise((resolve) => setTimeout(resolve, WIPE_TIMEOUT_MS))]);
}
