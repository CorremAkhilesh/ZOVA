import Dexie from 'dexie';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatRow, MessageRow } from '@/features/sync/local-db';
import { getUserDb, type LocalDb, PENDING_ORDER_BASE } from '@/features/sync/local-db';
import { useSyncStore } from '@/features/sync/store';
import { useLive } from '@/features/sync/use-live';
import { MESSAGE_PAGE } from './api';
import { useMyId } from './use-my-id';

/** The signed-in user's database. Null only for the moment a sign-out is finishing. */
export function useLocalDb(): LocalDb | null {
  const userId = useMyId();
  return userId ? getUserDb(userId) : null;
}

/** All chats, most recent activity first. Undefined until the first read. */
/**
 * My chats, newest first. Undefined until this user's database has been read: an empty list would
 * look like "nothing is locked" to screens that hide locked chats' content.
 */
export function useChats(): ChatRow[] | undefined {
  const db = useLocalDb();
  return useLive<ChatRow[] | undefined>(
    () => (db ? db.chats.orderBy('sortAt').reverse().toArray() : undefined),
    [db],
  );
}

/** What is waiting to be sent, per chat, so the list can show a clock or "Not sent". */
export function useUnsentByChat(): Map<string, 'pending' | 'failed'> | undefined {
  const db = useLocalDb();
  return useLive(async () => {
    const rows = (await db?.outbox.toArray()) ?? [];
    // In sending order, so each chat ends up with the state of its newest message.
    return new Map(rows.map((row) => [row.chatId, row.state]));
  }, [db]);
}

/** One chat; null when this device does not have it. */
export function useChat(chatId: string): ChatRow | null | undefined {
  const db = useLocalDb();
  return useLive(async () => (await db?.chats.get(chatId)) ?? null, [db, chatId]);
}

/** Enough to fill a screen; a chat with fewer stored messages fetches more straight away. */
const FIRST_SCREEN = 30;
/** How much more of the local history to read each time the user scrolls near the top. */
const LOCAL_STEP = MESSAGE_PAGE * 4;

export interface ConversationMessages {
  /** Oldest first; undefined until the first read. */
  rows: MessageRow[] | undefined;
  loadingOlder: boolean;
  loadFailed: boolean;
  hasOlder: boolean;
  loadOlder: () => void;
}

/**
 * The newest part of a chat from Dexie. Scrolling up first reads further back locally and only then
 * asks the server, so a long chat never loads more than the user has scrolled through.
 */
export function useConversationMessages(chat: ChatRow): ConversationMessages {
  const db = useLocalDb();
  const [limit, setLimit] = useState(LOCAL_STEP);
  const [reachedStart, setReachedStart] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const busy = useRef(false);

  const rows = useLive(async () => {
    if (!db) return [];
    const newestFirst = await db.messages
      .where('[chatId+order]')
      .between([chat.id, Dexie.minKey], [chat.id, Dexie.maxKey])
      .reverse()
      .limit(limit)
      .toArray();
    return newestFirst.reverse();
  }, [db, chat.id, limit]);

  const moreLocally = rows !== undefined && rows.length >= limit;
  const oldest = rows?.find((row) => row.order < PENDING_ORDER_BASE);
  const moreOnServer = !reachedStart && chat.seq > 0 && oldest?.seq !== 1;

  const loadOlder = useCallback(() => {
    if (busy.current) return;
    if (moreLocally) {
      setLimit((current) => current + LOCAL_STEP);
      return;
    }
    const { client } = useSyncStore.getState();
    if (!moreOnServer || !client) return;
    busy.current = true;
    setLoadingOlder(true);
    setLoadFailed(false);
    client
      .loadOlder(chat.id)
      .then((more) => {
        setReachedStart(!more);
        setLimit((current) => current + MESSAGE_PAGE);
      })
      .catch(() => setLoadFailed(true))
      .finally(() => {
        busy.current = false;
        setLoadingOlder(false);
      });
  }, [chat.id, moreLocally, moreOnServer]);

  // History was never loaded on this device (a new device, or after a reset).
  const client = useSyncStore((state) => state.client);
  const shortOfHistory = rows !== undefined && rows.length < FIRST_SCREEN && moreOnServer;
  useEffect(() => {
    if (shortOfHistory && client && !loadFailed) loadOlder();
  }, [client, loadFailed, loadOlder, shortOfHistory]);

  return {
    rows,
    loadingOlder,
    loadFailed,
    hasOlder: moreLocally || moreOnServer,
    loadOlder,
  };
}
