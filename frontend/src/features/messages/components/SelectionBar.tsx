import { Copy, CornerUpRight, Star, Trash2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useSyncStore } from '@/features/sync/store';
import { copyLines, targetOf } from '../rules';
import { useMessageUi } from '../store';

/** Replaces the composer while messages are being picked. */
export function SelectionBar() {
  const { t, i18n } = useTranslation();
  const selected = useMessageUi((state) => state.selected);
  const stop = useMessageUi((state) => state.stopSelecting);
  const set = useMessageUi((state) => state.set);
  // View once is never forwarded or starred.
  const usable = selected.filter((message) => !message.deleted && !message.viewOnce);
  // Nor is a poll.
  const forwardable = usable.filter((message) => !message.poll);

  const copy = () => {
    void navigator.clipboard
      .writeText(copyLines(usable, t('chats.you'), i18n.language))
      .then(() => toast.success(t('messages.copied')))
      .catch(() => toast.error(t('messages.copyFailed')));
    stop();
  };
  const star = () => {
    const { client } = useSyncStore.getState();
    for (const message of usable) {
      void client?.act({ type: 'star', ...targetOf(message), starred: true });
    }
    stop();
  };

  return (
    <div className="glass flex items-center gap-1 border-t px-3 py-2 md:px-8">
      <Button variant="ghost" size="icon" aria-label={t('messages.cancelSelect')} onClick={stop}>
        <X className="size-5" aria-hidden />
      </Button>
      <p role="status" className="flex-1 text-sm font-medium">
        {t('messages.selectedCount', { count: selected.length })}
      </p>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('messages.forward')}
        disabled={forwardable.length === 0}
        onClick={() => set({ forwarding: forwardable })}
      >
        <CornerUpRight className="size-5" aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('messages.copy')}
        disabled={usable.length === 0}
        onClick={copy}
      >
        <Copy className="size-5" aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('messages.star')}
        disabled={usable.length === 0}
        onClick={star}
      >
        <Star className="size-5" aria-hidden />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('messages.delete')}
        onClick={() => set({ deleting: selected })}
      >
        <Trash2 className="size-5" aria-hidden />
      </Button>
    </div>
  );
}
