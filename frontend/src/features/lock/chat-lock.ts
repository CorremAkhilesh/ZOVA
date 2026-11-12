import { useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { errorCode } from '@/features/auth/errors';
import { useLocalDb } from '@/features/chats/queries';
import type { ChatSummary } from '@/features/chats/types';
import type { ChatRow } from '@/features/sync/local-db';
import { LOCK_KEY, lockApi, lockQuery } from './api';
import { lockErrorMessage } from './errors';
import { useLockStore } from './store';

/** The normal list and folders: everything but locked chats. */
export function useWithoutLocked(rows: ChatRow[] | undefined): ChatRow[] | undefined {
  return useMemo(() => rows?.filter((row) => row.locked !== true), [rows]);
}

/**
 * A locked chat as the list shows it: never its text. No preview, draft, reaction or sender,
 * just "Locked"; the unread count stays.
 */
export function maskLocked(chat: ChatSummary, label: string): ChatSummary {
  return {
    ...chat,
    draft: null,
    reactionLine: undefined,
    pins: undefined,
    lastMessage: chat.lastMessage
      ? { authorId: '', authorName: '', text: label, at: chat.lastMessage.at, isSystem: true }
      : null,
  };
}

/** Lock or unlock a chat. Locking needs a PIN: without one, it asks for one first. */
export function useLockChat() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const db = useLocalDb();

  // Plain calls rather than a mutation: the menu that starts them closes straight away.
  async function save(chatId: string, locked: boolean): Promise<void> {
    try {
      await lockApi.lockChat(chatId, locked);
      // The sync log brings it too; this shows it at once.
      await db?.chats.update(chatId, { locked });
      toast.success(t(locked ? 'lock.chatLocked' : 'lock.chatUnlocked'));
    } catch (error) {
      if (errorCode(error) !== 'PIN_NOT_SET') {
        toast.error(lockErrorMessage(error, t));
        return;
      }
      void queryClient.invalidateQueries({ queryKey: LOCK_KEY });
      askForPin(chatId);
    }
  }
  function askForPin(chatId: string) {
    useLockStore.getState().requestSetup({ reason: 'new', onSet: () => void save(chatId, true) });
  }

  return (chatId: string, locked: boolean) => {
    const status = queryClient.getQueryData(lockQuery.queryKey);
    if (locked && status && !status.pinSet) askForPin(chatId);
    else void save(chatId, locked);
  };
}
