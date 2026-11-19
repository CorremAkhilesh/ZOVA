import { type PublicProfile, REACTIONS_QUICK, type Status } from '@zuvo/protocol';
import { Eye, SendHorizontal, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { reactToStatus, replyToStatus } from '../actions';

const ROUND =
  'grid size-11 shrink-0 place-items-center rounded-full bg-white/15 text-white hover:bg-white/25 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-white/70';

interface FooterProps {
  owner: PublicProfile;
  status: Status;
  /** Typing a reply: the status waits. */
  onTyping: (typing: boolean) => void;
}

/** Someone else's status: reply, or react with one tap. Both go to our 1:1 chat. */
export function ReplyFooter({ owner, status, onTyping }: FooterProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const send = async (work: () => Promise<unknown>) => {
    setSending(true);
    try {
      await work();
      toast.success(t('updates.replySent', { name: owner.displayName }));
      setText('');
    } catch {
      toast.error(t('updates.replyFailed'));
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="space-y-2">
      <ul aria-label={t('updates.quickReactions')} className="flex justify-center gap-1">
        {REACTIONS_QUICK.map((emoji) => (
          <li key={emoji}>
            <button
              type="button"
              disabled={sending}
              aria-label={t('updates.reactWith', { emoji })}
              className="grid size-11 place-items-center rounded-full text-2xl hover:bg-white/15 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-white/70 motion-safe:transition-transform motion-safe:active:scale-90"
              onClick={() => void send(() => reactToStatus(owner, status, emoji))}
            >
              {emoji}
            </button>
          </li>
        ))}
      </ul>
      <form
        className="flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (text.trim()) void send(() => replyToStatus(owner, status, text.trim()));
        }}
      >
        <label className="sr-only" htmlFor="status-reply">
          {t('updates.replyLabel', { name: owner.displayName })}
        </label>
        <input
          id="status-reply"
          value={text}
          maxLength={4096}
          autoComplete="off"
          placeholder={t('updates.replyPlaceholder')}
          onChange={(event) => setText(event.target.value)}
          onFocus={() => onTyping(true)}
          onBlur={() => onTyping(false)}
          className="h-11 min-w-0 flex-1 rounded-full border border-white/30 bg-black/30 px-4 text-[15px] text-white placeholder:text-white/70 focus-visible:border-white focus-visible:outline-none"
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          aria-label={t('updates.sendReply')}
          className={ROUND}
        >
          <SendHorizontal className="size-5" aria-hidden />
        </button>
      </form>
    </div>
  );
}

/** My own status: how many have seen it (opens the list), and delete. */
export function OwnFooter(props: { status: Status; onViewers: () => void; onDelete: () => void }) {
  const { t } = useTranslation();
  const count = props.status.viewCount;
  return (
    <div className="flex items-center justify-between gap-2">
      <button
        type="button"
        onClick={props.onViewers}
        className="flex h-11 items-center gap-2 rounded-full bg-white/15 px-4 text-sm font-medium text-white hover:bg-white/25 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-white/70"
      >
        <Eye className="size-5" aria-hidden />
        {count === null ? t('updates.viewedByHidden') : t('updates.viewedBy', { count })}
      </button>
      <button
        type="button"
        onClick={props.onDelete}
        aria-label={t('updates.delete')}
        className={ROUND}
      >
        <Trash2 className="size-5" aria-hidden />
      </button>
    </div>
  );
}
