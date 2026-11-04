import { useEffect, useRef } from 'react';
import type { ChatRow } from '@/features/sync/local-db';
import { useSyncStore } from '@/features/sync/store';
import { useDocumentVisible } from '@/lib/hooks';

/** Read state: tells the server only while the chat is open, visible and scrolled to the bottom. */
export function useMarkRead(chat: ChatRow, newestSeq: number, atBottom: boolean): void {
  const client = useSyncStore((state) => state.client);
  const connected = useSyncStore((state) => state.socket === 'connected');
  const visible = useDocumentVisible();
  const requested = useRef(0);

  useEffect(() => {
    if (!client || !connected || !visible || !atBottom) return;
    if (newestSeq <= chat.lastReadSeq || newestSeq <= requested.current) return;
    requested.current = newestSeq;
    void client.markRead(chat.id, newestSeq).catch(() => {
      requested.current = 0;
    });
  }, [atBottom, chat.id, chat.lastReadSeq, client, connected, newestSeq, visible]);

  // A dropped connection may have lost the request: ask again when it returns.
  useEffect(() => {
    if (!connected) requested.current = 0;
  }, [connected]);
}
