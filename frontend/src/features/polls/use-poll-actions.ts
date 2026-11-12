import type { Poll } from '@zuvo/protocol';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useSession } from '@/features/auth/session';
import { useLocalDb } from '@/features/chats/queries';
import type { ChatMessage } from '@/features/chats/types';
import { pollsApi } from './api';
import { withChoice } from './logic';

/**
 * Voting and closing. A vote shows at once in the local copy, and goes back to what it was if the
 * server refuses it. The server's answer (and the `message:updated` everyone gets) has the final say.
 */
export function usePollActions(message: ChatMessage) {
  const { t } = useTranslation();
  const db = useLocalDb();
  const me = useSession()?.user.id ?? '';
  const [closing, setClosing] = useState(false);
  // Votes go out one after another, and only the newest one's answer (or failure) counts.
  const latest = useRef(0);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const chatId = message.chatId;
  const messageId = message.serverId ?? '';

  const store = (poll: Poll | null | undefined) =>
    db?.messages.update(message.id, { poll: poll ?? null }).catch(() => undefined);

  /** `choose` gets the poll as this device has it right now, so quick taps build on each other. */
  async function vote(choose: (poll: Poll) => string[]) {
    const before = (await db?.messages.get(message.id))?.poll ?? message.poll;
    if (!before || !messageId) return;
    const optionIds = choose(before);
    latest.current += 1;
    const ticket = latest.current;
    await store(withChoice(before, me, optionIds));
    const sent = chain.current.then(() => pollsApi.vote(chatId, messageId, optionIds));
    chain.current = sent.catch(() => undefined);
    try {
      const { message: updated } = await sent;
      if (ticket === latest.current) await store(updated.poll);
    } catch {
      if (ticket !== latest.current) return;
      await store(before);
      toast.error(t('polls.voteFailed'));
    }
  }

  async function close() {
    if (!messageId) return;
    setClosing(true);
    try {
      const { message: updated } = await pollsApi.close(chatId, messageId);
      await store(updated.poll);
    } catch {
      toast.error(t('polls.closeFailed'));
    } finally {
      setClosing(false);
    }
  }

  return { me, vote, close, closing };
}
