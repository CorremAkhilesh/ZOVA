import {
  type AckResponse,
  type ErrorCode,
  MESSAGE_PREVIEW_MAX,
  type SendMessageAck,
  type SendMessagePayload,
} from '@zuvo/protocol';
import { uuidv7 } from '@/lib/uuid';
import { mergeChat } from './apply';
import { type LocalDb, type OutboxRow, PENDING_ORDER_BASE } from './local-db';

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
  /** Only one tab sends; the others just write to the shared database. */
  isLeader?: () => boolean;
  maxAttempts?: number;
  retryBaseMs?: number;
}

/** Worth trying again; every other error would fail the same way each time. */
const TRANSIENT: ReadonlySet<ErrorCode> = new Set(['INTERNAL_ERROR', 'SERVICE_UNAVAILABLE']);

/**
 * Sends queued messages strictly in order, one at a time. Offline time never counts as a failure.
 * A retry reuses the same clientMsgId, so a lost ack can never create a second message.
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
      const n = await db.outbox.add({ clientMsgId, chatId, text, attempts: 0, state: 'pending' });
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
        replyToId: null,
        editedAt: null,
        deletedForEveryoneAt: null,
        createdAt,
        status: 'pending',
      });
      const chat = await db.chats.get(chatId);
      if (chat) {
        const preview = {
          id: key,
          seq: chat.seq + 1,
          senderId: me,
          type: 'text' as const,
          preview: text.slice(0, MESSAGE_PREVIEW_MAX),
          createdAt,
        };
        // Moves up the list right away. The server's own position replaces this on arrival.
        await db.chats.put(
          mergeChat(chat, {
            seq: chat.seq,
            lastMessage: preview,
            lastActivityAt: createdAt,
            lastReadSeq: chat.lastReadSeq,
          }),
        );
      }
    });
    void this.flush();
    return clientMsgId;
  }

  /** "Not sent — tap to retry". */
  async retry(clientMsgId: string): Promise<void> {
    const { db, me } = this.options;
    await db.transaction('rw', db.outbox, db.messages, async () => {
      await db.outbox
        .where('clientMsgId')
        .equals(clientMsgId)
        .modify({ state: 'pending', attempts: 0 });
      await db.messages.update(`${me}:${clientMsgId}`, { status: 'pending' });
    });
    this.waitUntil = 0;
    void this.flush();
  }

  /** The connection is back: send now, without waiting out an earlier backoff. */
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
    } catch {
      // The database closed under us (sign-out) or storage failed; rows stay for the next attempt.
    } finally {
      this.running = false;
    }
  }

  private async drain(): Promise<void> {
    const { db, transport, isLeader } = this.options;
    while (!this.stopped) {
      if (!transport.isConnected() || isLeader?.() === false) return;
      if (Date.now() < this.waitUntil) return;
      const row = await db.outbox.where('state').equals('pending').first();
      if (!row) return;
      if (!(await this.sendOne(row))) return;
    }
  }

  /** False means stop for now: order matters, so later messages must not overtake this one. */
  private async sendOne(row: OutboxRow): Promise<boolean> {
    const { transport } = this.options;
    let ack: AckResponse<SendMessageAck>;
    try {
      ack = await transport.send({
        chatId: row.chatId,
        clientMsgId: row.clientMsgId,
        text: row.text,
      });
    } catch (error) {
      if (error instanceof DisconnectedError) return false;
      return this.failTransiently(row);
    }
    if (ack.ok) {
      await this.confirm(row, ack.data);
      return true;
    }
    const { code, details } = ack.error;
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
    const { db, maxAttempts = 5, retryBaseMs = 1000 } = this.options;
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

  private async markFailed(row: OutboxRow) {
    const { db, me } = this.options;
    await db.transaction('rw', db.outbox, db.messages, async () => {
      if (row.n !== undefined) await db.outbox.update(row.n, { state: 'failed' });
      await db.messages.update(`${me}:${row.clientMsgId}`, { status: 'failed' });
    });
  }

  private async confirm(row: OutboxRow, ack: SendMessageAck) {
    const { db, me } = this.options;
    await db.transaction('rw', db.outbox, db.messages, async () => {
      if (row.n !== undefined) await db.outbox.delete(row.n);
      const key = `${me}:${row.clientMsgId}`;
      // The message:new echo may have got here first; that copy is already complete.
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
