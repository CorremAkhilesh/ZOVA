import { chatsApi } from '@/features/chats/api';
import { applyChats } from '@/features/sync/apply';
import type { LocalDb } from '@/features/sync/local-db';
import { useSyncStore } from '@/features/sync/store';
import { resolveTheme, useThemeStore } from '@/features/theme/theme-store';
import { i18n } from '@/lib/i18n';

/** Light ↔ dark, from what is shown now (also when the setting follows the system). */
export function toggleTheme() {
  const { mode, setMode } = useThemeStore.getState();
  const shown =
    document.documentElement.dataset.theme ??
    resolveTheme(mode, window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  setMode(shown === 'dark' ? 'light' : 'dark');
}

/** English ↔ हिन्दी. */
export function switchLanguage() {
  void i18n.changeLanguage(i18n.language?.startsWith('hi') ? 'en' : 'hi');
}

/** The Saved Messages chat's id: this device's copy, or the server's (stored here first). */
export async function savedMessagesChatId(db: LocalDb | null): Promise<string> {
  const known = await db?.chats.filter((chat) => chat.type === 'self').first();
  if (known) return known.id;
  const chat = await chatsApi.selfChat();
  if (db) await applyChats(db, [chat]);
  return chat.id;
}

/** Marks every unread chat as read (and clears "marked unread"). Returns how many changed. */
export async function markAllRead(db: LocalDb | null): Promise<number> {
  const client = useSyncStore.getState().client;
  if (!db || !client) return 0;
  const chats = await db.chats
    .filter((chat) => chat.unreadCount > 0 || !!chat.markedUnread)
    .toArray();
  for (const chat of chats) {
    if (chat.unreadCount > 0) void client.markRead(chat.id, chat.seq);
    if (chat.markedUnread)
      void client.act({ type: 'prefs', chatId: chat.id, prefs: { unread: false } });
  }
  return chats.length;
}
