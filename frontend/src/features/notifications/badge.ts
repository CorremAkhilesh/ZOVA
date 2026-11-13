import { useEffect } from 'react';
import type { ChatRow } from '@/features/sync/local-db';
import { applyAppBadge, type BadgeNavigator } from '@/sw/push/badge';

/** Chats with something unread (or marked unread): the number on the app icon. */
export function unreadChatCount(rows: readonly ChatRow[]): number {
  return rows.filter((row) => row.unreadCount > 0 || row.markedUnread === true).length;
}

/**
 * Keeps the app icon's badge on the number of unread chats while the app is open (the service
 * worker sets it from pushes while it is closed). Nothing happens where badges are unsupported.
 */
export function useAppBadge(rows: readonly ChatRow[] | undefined): void {
  const count = rows ? unreadChatCount(rows) : null;
  useEffect(() => {
    if (count !== null) void applyAppBadge(navigator as BadgeNavigator, count);
  }, [count]);
}
