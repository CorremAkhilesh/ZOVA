import type {
  ChatSummary,
  CreateUploadBody,
  Mention,
  Message,
  PublicProfile,
} from '@zuvo/protocol';
import Dexie, { type Table } from 'dexie';
import type { ActionRow } from './actions-types';
import { releaseAllFiles } from './held-files';

/** Messages not yet accepted by the server sort after every real position. */
export const PENDING_ORDER_BASE = 1e12;

export type MessageStatus = 'pending' | 'failed' | 'sent';
/** Why a file was not sent, when the person can do something about it. */
export type UploadFailReason = 'fileLost' | 'diskFull' | 'overLimit';

export interface MessageRow extends Omit<Message, 'id' | 'seq'> {
  /** Stable across send and ack, so re-applying a message can never duplicate it. */
  key: string;
  /** Null until the server accepts the message. */
  id: string | null;
  seq: number | null;
  /** `seq`, or PENDING_ORDER_BASE + the outbox number while unsent. */
  order: number;
  status: MessageStatus;
  /** How much of its file has reached the server, while uploading. */
  uploadedBytes?: number;
  /** Its file is only held by an open tab. See held-files.ts. */
  heldInTab?: boolean;
  failReason?: UploadFailReason | undefined;
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
  /** When it was queued, retried or last made progress, in ms. Older rows count as long overdue. */
  queuedAt?: number;
  /** A media message: what to upload, then the upload's ids. The file itself is in `files`. */
  media?: CreateUploadBody;
  uploadId?: string | undefined;
  mediaId?: string;
  albumId?: string | undefined;
  /** The file is not in `files`: only an open tab has it. See held-files.ts. */
  heldInTab?: boolean;
  /** The message this answers. */
  replyTo?: { chatId: string; messageId: string } | undefined;
  /** A link preview the sender kept, by its id on the server. */
  linkPreviewId?: string | undefined;
  /** Groups: who the text mentions. */
  mentions?: Mention[] | undefined;
  mentionsEveryone?: boolean | undefined;
}

/** A Blob, or its bytes where a browser cannot keep Blobs. See stored-bytes.ts. */
export type StoredBytes = Blob | { bytes: ArrayBuffer; type: string };

/** A file waiting to be uploaded, kept until the server has its message. */
export interface FileRow {
  clientMsgId: string;
  file: StoredBytes;
  poster?: StoredBytes;
}

export interface ThumbRow {
  mediaId: string;
  blob: StoredBytes;
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
  files!: Table<FileRow, string>;
  thumbs!: Table<ThumbRow, string>;
  actions!: Table<ActionRow, number>;

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
    this.version(2).stores({ files: 'clientMsgId', thumbs: 'mediaId' });
    this.version(3).stores({ actions: '++n' });
  }
}

const DB_PREFIX = 'zuvo-user-';
const open = new Map<string, LocalDb>();
/** Handed out while a wipe runs: closed for good, so a late read or write cannot reopen it. */
const retired = new Map<string, LocalDb>();
let wipesRunning = 0;

function closedForGood(db: LocalDb): LocalDb {
  db.close({ disableAutoOpen: true });
  return db;
}

/** One database per signed-in user, so two people on one browser never mix. */
export function getUserDb(userId: string): LocalDb {
  if (wipesRunning > 0) {
    // A screen re-rendering during sign-out. Opening the database now would block the delete,
    // or create it again right after: its queries fail instead, and the screen is going anyway.
    const db = retired.get(userId) ?? closedForGood(new LocalDb(`${DB_PREFIX}${userId}`));
    retired.set(userId, db);
    return db;
  }
  const existing = open.get(userId);
  if (existing && !existing.hasBeenClosed()) return existing;
  const db = new LocalDb(`${DB_PREFIX}${userId}`);
  open.set(userId, db);
  return db;
}

export interface WipeResult {
  /** False when a database could not be deleted yet: it is deleted when the app next opens. */
  complete: boolean;
}

/** How long one delete may wait for other tabs to let go (tests shorten it), and how many times. */
export const wipeTiming = { attemptMs: 3000 };
const WIPE_ATTEMPTS = 3;
const PENDING_KEY = 'zuvo-wipe-pending';

const userDatabases = async () =>
  (await Dexie.getDatabaseNames()).filter((name) => name.startsWith(DB_PREFIX));

async function deleteWithin(name: string, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    // A blocked delete stays queued in the browser; asking again just queues another.
    Dexie.delete(name).catch(() => undefined),
    new Promise((resolve) => {
      timer = setTimeout(resolve, ms);
    }),
  ]);
  clearTimeout(timer);
}

const remember = (names: string[]) => {
  try {
    if (names.length) localStorage.setItem(PENDING_KEY, JSON.stringify(names));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    // No storage: the next wipe still finds the databases by name.
  }
};

/**
 * Deletes every user's local chats, messages, outbox and drafts on this browser. Every connection
 * this tab has is closed for good first. A delete another tab blocks is asked again a few times; if
 * it still has not happened, that is reported and remembered, never silently left behind.
 */
export async function wipeLocalDatabases(): Promise<WipeResult> {
  const { attemptMs } = wipeTiming;
  wipesRunning += 1;
  try {
    releaseAllFiles();
    for (const db of open.values()) closedForGood(db);
    open.clear();
    for (let attempt = 1; attempt <= WIPE_ATTEMPTS; attempt++) {
      const left = await userDatabases();
      if (left.length === 0) break;
      await Promise.all(left.map((name) => deleteWithin(name, attemptMs)));
    }
    const left = await userDatabases();
    remember(left);
    if (left.length)
      console.error(`[wipe] ${left.length} local database(s) could not be deleted yet`);
    return { complete: left.length === 0 };
  } finally {
    wipesRunning -= 1;
    if (wipesRunning === 0) retired.clear();
  }
}

/** A wipe that a blocked delete left unfinished. */
export function hasPendingWipe(): boolean {
  try {
    return localStorage.getItem(PENDING_KEY) !== null;
  } catch {
    return false;
  }
}
