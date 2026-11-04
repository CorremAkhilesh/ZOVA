import type { ChatSummary, Message, SyncResponse } from '@zuvo/protocol';
import { ApiClientError } from '@/lib/api-client';
import {
  type ApplyResult,
  applyChats,
  applyLiveChatChange,
  applyLiveMessage,
  applyReset,
  applySyncPage,
  readCursor,
} from './apply';
import type { LocalDb } from './local-db';

export type SyncStatus = 'syncing' | 'idle' | 'error';

export interface SyncApi {
  sync(since: string | undefined): Promise<SyncResponse>;
  listAllChats(): Promise<ChatSummary[]>;
  selfChat(): Promise<ChatSummary>;
}

interface SyncEngineOptions {
  db: LocalDb;
  me: string;
  api: SyncApi;
  onStatus?: (status: SyncStatus) => void;
  /** The server no longer accepts this session. */
  onUnauthorized?: () => void;
  retryBaseMs?: number;
}

const RETRY_MAX_MS = 30_000;

/**
 * Keeps the local database caught up: applies live events in order, and calls GET /v1/sync on every
 * connect and whenever an event proves that something is missing. See docs/protocol.md.
 */
export class SyncEngine {
  private readonly options: SyncEngineOptions;
  private events: Promise<unknown> = Promise.resolve();
  private running: Promise<void> | null = null;
  private again = false;
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;

  constructor(options: SyncEngineOptions) {
    this.options = options;
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.retryTimer);
  }

  /** Catches up now. A call during a run schedules one more, so nothing arrives unseen. */
  run(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.loop().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  onMessage(message: Message, cursor: string): Promise<void> {
    const { db, me } = this.options;
    return this.inOrder(() => applyLiveMessage(db, me, message, cursor));
  }

  onChatChange(
    chatId: string,
    change: Parameters<typeof applyLiveChatChange>[2],
    cursor: string,
  ): Promise<void> {
    return this.inOrder(() => applyLiveChatChange(this.options.db, chatId, change, cursor));
  }

  /** Events apply one at a time, in arrival order: database writes finish asynchronously. */
  private inOrder(apply: () => Promise<ApplyResult>): Promise<void> {
    const next = this.events.then(async () => {
      if (this.stopped) return;
      const result = await apply().catch(() => 'gap' as const);
      if (result === 'gap' && !this.stopped) void this.run();
    });
    this.events = next;
    return next;
  }

  private async loop(): Promise<void> {
    const { onStatus } = this.options;
    clearTimeout(this.retryTimer);
    onStatus?.('syncing');
    try {
      do {
        this.again = false;
        await this.catchUp();
      } while (this.again && !this.stopped);
      this.failures = 0;
      if (!this.stopped) onStatus?.('idle');
    } catch (error) {
      if (this.stopped) return;
      if (error instanceof ApiClientError && error.status === 401) {
        this.options.onUnauthorized?.();
        return;
      }
      onStatus?.('error');
      this.scheduleRetry();
    }
  }

  private scheduleRetry() {
    const base = this.options.retryBaseMs ?? 2000;
    const delay = Math.min(RETRY_MAX_MS, base * 2 ** this.failures);
    this.failures += 1;
    this.retryTimer = setTimeout(() => void this.run(), delay);
  }

  private async catchUp(): Promise<void> {
    const { db, me, api } = this.options;
    let cursor = await readCursor(db);
    let more = true;
    while (more && !this.stopped) {
      const page = await api.sync(cursor);
      if (page.reset) {
        // Chats first, cursor last: a failed reload leaves no cursor, so the next run retries it.
        const chats = await api.listAllChats();
        if (this.stopped) return;
        await applyReset(db, chats, page.cursor);
      } else {
        await applySyncPage(db, me, page);
      }
      cursor = page.cursor;
      more = page.hasMore;
    }
    await this.ensureSavedMessages();
  }

  /** Saved Messages is always available: the server creates it on the first request. */
  private async ensureSavedMessages() {
    const { db, api } = this.options;
    const known = await db.chats.filter((chat) => chat.type === 'self').first();
    if (known || this.stopped) return;
    const chat = await api.selfChat();
    if (!this.stopped) await applyChats(db, [chat]);
  }
}
