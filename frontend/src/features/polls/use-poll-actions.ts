import type { Poll } from '@zuvo/protocol';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useLocalDb } from '@/features/chats/queries';
import type { ChatMessage } from '@/features/chats/types';
import { useMyId } from '@/features/chats/use-my-id';
import { useSyncStore } from '@/features/sync/store';
import { pollsApi } from './api';

/**
 * Voting and closing. A vote goes through the action queue: shown at once, kept if offline and sent
 * once the connection is back, in order with my other changes. If the server refuses it, the queue
 * puts the poll back as the server has it. `message:updated` brings everyone else's votes.
 */
export function usePollActions(message: ChatMessage) {
  const { t } = useTranslation();
  const db = useLocalDb();
  const me = useMyId() ?? '';
  const client = useSyncStore((state) => state.client);
  const [closing, setClosing] = useState(false);
  const chatId = message.chatId;
  const messageId = message.serverId ?? '';

  /** `choose` gets the poll as this device has it right now, so quick taps build on each other. */
  async function vote(choose: (poll: Poll) => string[]) {
    const current = (await db?.messages.get(message.id))?.poll ?? message.poll;
    if (!current || !messageId || message.seq == null || !client) return;
    await client.act({
      type: 'vote',
      chatId,
      messageId,
      seq: message.seq,
      optionIds: choose(current),
    });
  }

  async function close() {
    if (!messageId) return;
    setClosing(true);
    try {
      const { message: updated } = await pollsApi.close(chatId, messageId);
      await db?.messages.update(message.id, { poll: updated.poll ?? null }).catch(() => undefined);
    } catch {
      toast.error(t('polls.closeFailed'));
    } finally {
      setClosing(false);
    }
  }

  return { me, vote, close, closing };
}
