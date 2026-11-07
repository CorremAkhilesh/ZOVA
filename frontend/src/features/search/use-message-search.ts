import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type { SearchFilter } from '@zuvo/protocol';
import { useMemo } from 'react';
import { useLocalDb } from '@/features/chats/queries';
import type { ChatRow } from '@/features/sync/local-db';
import { useDebouncedValue } from '@/lib/hooks';
import { searchApi } from './api';
import { searchLocalMessages } from './local-search';

export interface MessageHit {
  key: string;
  chatId: string;
  seq: number;
  text: string;
  at: string;
  type: string;
  senderName: string | null;
  /** Null: the app names it (Saved Messages, or a chat this device does not have yet). */
  chatTitle: string | null;
  chatType: ChatRow['type'];
}

export interface SearchParams {
  q: string;
  filter?: SearchFilter | undefined;
  chatId?: string | undefined;
}

const titleOf = (row: ChatRow | undefined) =>
  row?.type === 'self' ? null : (row?.group?.name ?? row?.otherUser?.displayName ?? null);

/**
 * Messages matching what was typed: this device's copies at once, then the server's, which also
 * covers history never loaded here. One list, newest first, each message once.
 */
export function useMessageSearch(params: SearchParams, chats: ChatRow[] | undefined) {
  const db = useLocalDb();
  const q = useDebouncedValue(params.q.trim(), 250);
  const { filter, chatId } = params;
  const enabled = q.length > 0 || filter !== undefined;
  const local = useQuery({
    queryKey: ['search', 'local', q, filter, chatId],
    queryFn: () => (db ? searchLocalMessages(db, { q, filter, chatId }) : []),
    enabled: enabled && db !== null,
  });
  const server = useInfiniteQuery({
    queryKey: ['search', 'messages', q, filter, chatId],
    queryFn: ({ pageParam }) => searchApi.messages({ q, filter, chatId, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
    staleTime: 30_000,
    retry: false,
  });

  const hits = useMemo(() => {
    const byChat = new Map((chats ?? []).map((chat) => [chat.id, chat]));
    const merged = new Map<string, MessageHit>();
    for (const row of enabled ? (local.data ?? []) : []) {
      if (row.seq === null) continue;
      const chat = byChat.get(row.chatId);
      merged.set(`${row.chatId}:${row.seq}`, {
        key: `${row.chatId}:${row.seq}`,
        chatId: row.chatId,
        seq: row.seq,
        text: row.text ?? '',
        at: row.createdAt,
        type: row.type,
        senderName: null,
        chatTitle: titleOf(chat),
        chatType: chat?.type ?? 'direct',
      });
    }
    for (const page of enabled ? (server.data?.pages ?? []) : []) {
      for (const { message, chat, senderName } of page.items) {
        const key = `${message.chatId}:${message.seq}`;
        merged.set(key, {
          key,
          chatId: message.chatId,
          seq: message.seq,
          text: message.text ?? '',
          at: message.createdAt,
          type: message.type,
          senderName,
          chatTitle: chat.title,
          chatType: chat.type,
        });
      }
    }
    return [...merged.values()].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }, [chats, enabled, local.data, server.data]);

  return {
    q,
    hits,
    /** The server is still answering the first page. */
    loading: enabled && server.isPending,
    failed: server.isError,
    hasMore: server.hasNextPage,
    loadMore: () => void server.fetchNextPage(),
    loadingMore: server.isFetchingNextPage,
  };
}
