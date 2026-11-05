import {
  type AckResponse,
  type ErrorCode,
  type LastMessage,
  MESSAGE_PREVIEW_MAX,
  type SendMessageAck,
  type SendMessagePayload,
} from '@zuvo/protocol';
import { uuidv7 } from '@/lib/uuid';
import { mergeChat } from './apply';
import {
  type LocalDb,
  type OutboxRow,
  PENDING_ORDER_BASE,
  type UploadFailReason,
} from './local-db';
import { type EnqueueMedia, removeQueued, storeMedia, toPayload } from './outbox-media';

export type { EnqueueMedia };
export class DisconnectedError extends Error {}

export interface OutboxTransport {
  isConnected(): boolean;
  /** Rejects with DisconnectedError if the connection drops, or any error on a timeout. */
  send(payload: SendMessagePayload): Promise<AckResponse<SendMessageAck>>;
}

interface OutboxOptions {
  db: LocalDb;
  me: string;
  transport: OutboxTransport;
  /** Normally one tab sends; the others step in only for what stays unsent for too long. */
  isLeader?: () => boolean;
  /** How long another tab gets to send a message before this one does it instead. */
  takeoverMs?: number;
  maxAttempts?: number;
  retryBaseMs?: number;
  /** Anything that stops a message moving. Never contains message text. */
  onProblem?: (problem: string) => void;
  /** A file is waiting for the uploader. */
  onMediaQueued?: () => void;
}

/** Worth trying again; anything else would just fail the same way. */
const TRANSIENT: ReadonlySet<ErrorCode> = new Set(['INTERNAL_ERROR', 'SERVICE_UNAVAILABLE']);

const TAKEOVER_MS = 5000;
const STORAGE_RETRY_MS = 5000;

/**
 * Sends queued messages strictly in order, one at a time. Offline time never counts as a failure.
 * A retry reuses the same clientMsgId, so a lost ack can never create a second message. With a
 * connection, every message ends up either sent or marked "Not sent": it never just waits.
 */
export class Outbox {
  private readonly options: OutboxOptions;
  private running = false;
  private again = false;
  private stopped = false;
  private waitUntil = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: OutboxOptions) {
    this.options = options;
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  /** Stored locally first: it shows at once with a clock, and survives a reload or going offline. */
  async enqueue(chatId: string, text: string): Promise<string> {
    const { db, me } = this.options;
    const clientMsgId = uuidv7();
    const key = `${me}:${clientMsgId}`;
    const createdAt = new Date().toISOString();
    await db.transaction('rw', db.outbox, db.messages, db.chats, async () => {
      const n = await db.outbox.add({
        clientMsgId,
        chatId,
        text,
        attempts: 0,
        state: 'pending',
        queuedAt: Date.now(),
      });
      await db.messages.add({
        key,
        id: null,
        seq: null,
        order: PENDING_ORDER_BASE + n,
        chatId,
        clientMsgId,
        senderId: me,
        type: 'text',
        text,
        media: null,
        albumId: null,
        replyToId: null,
        editedAt: null,
        deletedForEveryoneAt: null,
        createdAt,
        status: 'pending',
      });
      await this.previewInChat(chatId, key, {
        type: 'text',
        preview: text.slice(0, MESSAGE_PREVIEW_MAX),
        createdAt,
      });
    });
    void this.flush();
    return clientMsgId;
  }

  /** Moves the chat up the list right away. The server's own position replaces this on arrival. */
  private async previewInChat(
    chatId: string,
    key: string,
    last: { type: LastMessage['type']; preview: string; createdAt: string },
  ) {
    const { db, me } = this.options;
    const chat = await db.chats.get(chatId);
    if (!chat) return;
    await db.chats.put(
      mergeChat(chat, {
        seq: chat.seq,
        lastMessage: { id: key, seq: chat.seq + 1, senderId: me, ...last },
        lastActivityAt: last.createdAt,
        lastReadSeq: chat.lastReadSeq,
      }),
    );
  }

  async enqueueMedia(input: EnqueueMedia): Promise<string> {
    const { db, me } = this.options;
    const clientMsgId = await storeMedia(db, me, input, (...args) => this.previewInChat(...args));
    this.options.onMediaQueued?.();
    return clientMsgId;
  }

  cancel(clientMsgId: string): Promise<string | undefined> {
    const { db, me } = this.options;
    return removeQueued(db, me, clientMsgId);
  }

  async retry(clientMsgId: string): Promise<void> {
    const { db, me } = this.options;
    await db.transaction('rw', db.outbox, db.messages, async () => {
      await db.outbox
        .where('clientMsgId')
        .equals(clientMsgId)
        .modify({ state: 'pending', attempts: 0, queuedAt: Date.now() });
      await db.messages.update(`${me}:${clientMsgId}`, {
        status: 'pending',
        failReason: undefined,
      });
    });
    this.waitUntil = 0;
    void this.flush();
  }

  /** The connection is back: send now, ignoring any earlier wait. */
  resume(): void {
    this.waitUntil = 0;
    void this.flush();
  }

  async flush(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.again = false;
        await this.drain();
      } while (this.again && !this.stopped);
    } catch (error) {
      // Storage failed, or closed under us at sign-out. The rows are safe, so try again shortly.
      if (!this.stopped) {
        this.report(`outbox stopped: ${error instanceof Error ? error.name : 'unknown error'}`);
        this.pause(STORAGE_RETRY_MS);
      }
    } finally {
      this.running = false;
    }
  }

  private async drain(): Promise<void> {
    const { db, transport } = this.options;
    while (!this.stopped) {
      if (!transport.isConnected()) return;
      if (Date.now() < this.waitUntil) {
        // A timer can fire a moment early. Without this nothing would ever wake the outbox again.
        this.pause(this.waitUntil - Date.now());
        return;
      }
      const rows = await db.outbox.where('state').equals('pending').toArray();
      // A file still uploading holds up only itself: other messages can go ahead of it.
      const row = rows.find((candidate) => !candidate.media || candidate.mediaId);
      if (!row) return;
      const waitForLeader = this.leaderGrace(row);
      if (waitForLeader > 0) {
        this.pause(waitForLeader);
        return;
      }
      if (!(await this.sendOne(row))) return;
    }
  }

  leaderGrace(row: Pick<OutboxRow, 'queuedAt'>): number {
    const { isLeader, takeoverMs = TAKEOVER_MS } = this.options;
    if (isLeader?.() !== false) return 0;
    return takeoverMs - (Date.now() - (row.queuedAt ?? 0));
  }

  private report(problem: string) {
    console.error(`[outbox] ${problem}`);
    this.options.onProblem?.(problem);
  }

  /** False means stop for now: order matters, so later messages must not overtake this one. */
  private async sendOne(row: OutboxRow): Promise<boolean> {
    const { transport } = this.options;
    let ack: AckResponse<SendMessageAck>;
    try {
      ack = await transport.send(toPayload(row));
    } catch (error) {
      if (error instanceof DisconnectedError) return false;
      this.report('no answer from the server');
      return this.failTransiently(row);
    }
    if (ack.ok) {
      await this.confirm(row, ack.data);
      return true;
    }
    const { code, details } = ack.error;
    this.report(`message:send refused: ${code}`);
    if (code === 'SESSION_EXPIRED') return false;
    if (code === 'RATE_LIMITED') {
      const seconds = Number(details?.retryAfterSeconds ?? 1);
      this.pause(seconds * 1000);
      return false;
    }
    if (TRANSIENT.has(code)) return this.failTransiently(row);
    await this.markFailed(row);
    return true;
  }

  private async failTransiently(row: OutboxRow): Promise<boolean> {
    const { db, maxAttempts = 3, retryBaseMs = 1000 } = this.options;
    const attempts = row.attempts + 1;
    if (attempts >= maxAttempts) {
      await this.markFailed(row);
      return true;
    }
    if (row.n !== undefined) await db.outbox.update(row.n, { attempts });
    this.pause(retryBaseMs * 2 ** (attempts - 1));
    return false;
  }

  private pause(ms: number) {
    this.waitUntil = Date.now() + ms;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), ms);
  }

  async markFailed(row: OutboxRow, reason?: UploadFailReason) {
    const { db, me } = this.options;
    await db.transaction('rw', db.outbox, db.messages, async () => {
      if (row.n !== undefined) await db.outbox.update(row.n, { state: 'failed' });
      await db.messages.update(`${me}:${row.clientMsgId}`, {
        status: 'failed',
        failReason: reason,
      });
    });
  }

  private async confirm(row: OutboxRow, ack: SendMessageAck) {
    const { db, me } = this.options;
    await db.transaction('rw', db.outbox, db.messages, db.files, async () => {
      if (row.n !== undefined) await db.outbox.delete(row.n);
      await db.files.delete(row.clientMsgId);
      const key = `${me}:${row.clientMsgId}`;
      const message = await db.messages.get(key);
      if (message && message.status !== 'sent') {
        await db.messages.put({
          ...message,
          id: ack.messageId,
          seq: ack.seq,
          order: ack.seq,
          createdAt: ack.createdAt,
          status: 'sent',
        });
      }
    });
  }
}
