import { Pencil, Reply, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/features/auth/session';
import { quoteText } from '@/features/polls/preview';
import { useMessageUi } from '../store';

/** "Replying to…" or "Editing", above the composer, with a way out. */
export function ComposerBanner({ chatId }: { chatId: string }) {
  const { t } = useTranslation();
  const me = useSession()?.user.id;
  const quote = useMessageUi((state) => state.replies[chatId]);
  const editing = useMessageUi((state) =>
    state.editing?.chatId === chatId ? state.editing : null,
  );
  if (!quote && !editing) return null;
  const who = quote?.senderId === me ? t('chats.you') : quote?.senderName;
  const Icon = editing ? Pencil : Reply;
  return (
    <div className="mb-1.5 flex items-center gap-2 rounded-xl border-l-4 border-brand bg-surface px-3 py-1.5 text-sm">
      <Icon className="size-4 shrink-0 text-brand-text" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-brand-text">
          {editing ? t('messages.editing') : t('messages.replyingTo', { name: who })}
        </p>
        <p className="truncate text-text-muted">
          {editing ? editing.text : quote && quoteText(quote)}
        </p>
      </div>
      <button
        type="button"
        aria-label={t(editing ? 'messages.cancelEdit' : 'messages.cancelReply')}
        className="tap-target rounded-full p-1 text-text-muted hover:bg-background"
        onClick={() => {
          const ui = useMessageUi.getState();
          if (editing) ui.setEditing(null);
          else ui.setReply(chatId, undefined);
        }}
      >
        <X className="size-4" aria-hidden />
      </button>
    </div>
  );
}
