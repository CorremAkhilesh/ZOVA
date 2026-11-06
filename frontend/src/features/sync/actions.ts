import { chatResponseSchema, forwardResponseSchema, okResponseSchema } from '@zuvo/protocol';
import { chatsApi } from '@/features/chats/api';
import { ApiClientError, apiDelete, apiPatch, apiPost, apiPut } from '@/lib/api-client';
import { applyLocally } from './actions-local';
import type { ActionRow, QueuedAction } from './actions-types';
import { applyChats, applyHistory } from './apply';
import { clearUpTo } from './local-changes';
import type { LocalDb } from './local-db';

const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30_000;

const onMessage = (action: { chatId: string; messageId: string }, tail = '') =>
  `/v1/chats/${action.chatId}/messages/${action.messageId}${tail}`;

/** Every one of these is safe to send twice: a lost answer can never do it twice. */
export function sendAction(action: QueuedAction): Promise<unknown> {
  const ok = okResponseSchema;
  switch (action.type) {
    case 'edit':
      return apiPatch(onMessage(action), { text: action.text }, ok);
    case 'delete':
      return apiDelete(onMessage(action, `?scope=${action.scope}`), ok);
    case 'react':
      return action.emoji
        ? apiPut(onMessage(action, '/reaction'), { emoji: action.emoji }, ok)
        : apiDelete(onMessage(action, '/reaction'), ok);
    case 'star':
      return action.starred
        ? apiPut(onMessage(action, '/star'), undefined, ok)
        : apiDelete(onMessage(action, '/star'), ok);
    case 'prefs':
      return apiPatch(`/v1/chats/${action.chatId}/prefs`, action.prefs, chatResponseSchema);
    case 'clear':
      return action.removeChat
        ? apiDelete(`/v1/chats/${action.chatId}`, ok)
        : apiPost(`/v1/chats/${action.chatId}/clear`, undefined, ok);
    case 'forward': {
      const { type: _type, ...body } = action;
      return apiPost('/v1/forward', body, forwardResponseSchema);
    }
  }
}

const isTransient = (error: unknown) =>
  !(error instanceof ApiClientError) ||
  error.isNetworkError ||
  error.status >= 500 ||
  error.status === 429 ||
  error.status === 401;

/** Asks the server how things really are, after it said no. */
async function restore(db: LocalDb, me: string, action: QueuedAction) {
  if (action.type === 'forward') return;
  const seq = 'seq' in action && action.type !== 'clear' ? action.seq + 1 : undefined;
  if (action.type !== 'prefs') {
    const page = await chatsApi.history(action.chatId, seq);
    await applyHistory(db, me, page.items);
  }
  await applyChats(db, [await chatsApi.getChat(action.chatId)]);
}

interface ActionQueueOptions {
  db: LocalDb;
  me: string;
  isLeader: () => boolean;
  onRefused?: (reason: string) => void;
  retryBaseMs?: number;
}

/**
 * Edits, deletes, reactions and the rest, in the order they were done. Stored first, so they survive
 * a reload or going offline. One tab sends, and the server may refuse: then the local change is undone.
 */
export class ActionQueue {
  private readonly options: ActionQueueOptions;
  private running = false;
  private again = false;
  private stopped = false;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: ActionQueueOptions) {
    this.options = options;
  }

  async enqueue(action: QueuedAction): Promise<void> {
    const { db, me } = this.options;
    await db.transaction('rw', [db.actions, db.messages, db.chats, db.drafts], async () => {
      await db.actions.add(action as ActionRow);
      await applyLocally(db, me, action);
    });
    this.resume();
  }

  resume(): void {
    clearTimeout(this.timer);
    void this.drain();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private async drain(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.again = false;
        while (await this.sendNext());
      } while (this.again && !this.stopped);
    } catch {
      // Storage closed under us at sign-out, or failed: the rows are safe, and a later wake retries.
    } finally {
      this.running = false;
    }
  }

  /** False means stop for now: order matters, so later ones must not overtake this one. */
  private async sendNext(): Promise<boolean> {
    const { db, isLeader } = this.options;
    if (this.stopped || !isLeader() || !globalThis.navigator?.onLine) return false;
    const row = await db.actions.orderBy('n').first();
    if (row?.n === undefined) return false;
    try {
      await sendAction(row);
      this.failures = 0;
    } catch (error) {
      if (isTransient(error)) {
        this.retryLater();
        return false;
      }
      await this.refused(row, error as ApiClientError);
    }
    await db.actions.delete(row.n);
    return true;
  }

  private retryLater() {
    const base = this.options.retryBaseMs ?? RETRY_BASE_MS;
    const delay = Math.min(RETRY_MAX_MS, base * 2 ** this.failures);
    this.failures += 1;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.drain(), delay);
  }

  private async refused(row: ActionRow, error: ApiClientError) {
    const { db, me, onRefused } = this.options;
    // Already done, by this device a moment ago or another one: there is nothing to undo.
    if (row.type === 'delete' && row.scope === 'me' && error.status === 404) return;
    // A chat this person can no longer reach goes from this device too.
    if (row.type === 'clear' && error.status === 404) {
      await clearUpTo(db, row);
      return;
    }
    onRefused?.(error.message);
    await restore(db, me, row).catch(() => undefined);
  }
}
