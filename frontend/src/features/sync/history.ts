import Dexie from 'dexie';
import { chatsApi } from '@/features/chats/api';
import { applyChats, applyHistory } from './apply';
import { type LocalDb, PENDING_ORDER_BASE } from './local-db';

const RECONCILE_MS = 30_000;

type HistoryApi = Pick<typeof chatsApi, 'history' | 'getChat'>;

/** Loads the page before the oldest local message. False once the start of the chat is reached. */
export async function loadOlderMessages(db: LocalDb, me: string, chatId: string): Promise<boolean> {
  const oldest = await db.messages
    .where('[chatId+order]')
    .between([chatId, Dexie.minKey], [chatId, PENDING_ORDER_BASE], true, false)
    .first();
  if (oldest?.seq === 1) return false;
  const page = await chatsApi.history(chatId, oldest?.seq ?? undefined);
  await applyHistory(db, me, page.items);
  return page.hasMore;
}

/** Chats where this device still shows a message as unsent. */
async function chatsWithUnsent(db: LocalDb): Promise<string[]> {
  const chatIds = await db.chats.toCollection().primaryKeys();
  const unsent = await Promise.all(
    chatIds.map((chatId) =>
      db.messages
        .where('[chatId+order]')
        .between([chatId, PENDING_ORDER_BASE], [chatId, Dexie.maxKey])
        .count(),
    ),
  );
  return chatIds.filter((_chatId, index) => (unsent[index] ?? 0) > 0);
}

/**
 * Asks the server about chats with unsent messages. If it has one, its row replaces the local one by
 * sender + clientMsgId, and the outbox lets go of it. Acks and live events are only the fast path:
 * whatever happened to them, what the server says settles it.
 */
export async function reconcileWithServer(
  db: LocalDb,
  me: string,
  api: HistoryApi = chatsApi,
): Promise<void> {
  for (const chatId of await chatsWithUnsent(db)) {
    const [page, chat] = await Promise.all([api.history(chatId, undefined), api.getChat(chatId)]);
    await applyHistory(db, me, page.items);
    await applyChats(db, [chat]);
  }
}

/** Now and then: wakes anything that may have stopped, and settles unsent messages. */
export function startReconciling(db: LocalDb, me: string, wake: () => void) {
  const timer = setInterval(() => {
    if (!globalThis.navigator?.onLine) return;
    wake();
    void reconcileWithServer(db, me).catch(() => undefined);
  }, RECONCILE_MS);
  return { stop: () => clearInterval(timer) };
}
