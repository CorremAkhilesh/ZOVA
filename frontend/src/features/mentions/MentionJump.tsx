import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useMessageUi } from '@/features/messages/store';
import type { ChatRow } from '@/features/sync/local-db';

/**
 * "@": takes me to the oldest message that mentions me, then the next one. Opening a chat at the
 * bottom marks it read at once, which clears the mentions: the ones unread when I came in (and any
 * that arrive while I am here) stay on the button until I have jumped to each.
 */
export function MentionJump({ chat }: { chat: ChatRow }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<number[]>([]);
  const unread = (chat.mentionSeqs ?? []).filter((seq) => seq > chat.lastReadSeq);
  const key = unread.join(',');

  useEffect(() => {
    if (!key) return;
    const seqs = key.split(',').map(Number);
    setPending((current) => [...new Set([...current, ...seqs])].sort((a, b) => a - b));
  }, [key]);

  const oldest = pending[0];
  if (oldest === undefined) return null;
  return (
    <Button
      variant="outline"
      size="icon"
      aria-label={t('mentions.jump', { count: pending.length })}
      onClick={() => {
        useMessageUi.getState().set({ jump: { chatId: chat.id, seq: oldest } });
        setPending((current) => current.slice(1));
      }}
      className="absolute right-4 bottom-16 rounded-full font-bold text-accent-text shadow-md"
    >
      @
    </Button>
  );
}
