import { type PublicProfile, REACTIONS_QUICK, type Status } from '@zuvo/protocol';
import { ChevronUp, Eye, SendHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { reactToStatus, replyToStatus } from '../actions';

const ROUND =
  'grid size-11 shrink-0 place-items-center rounded-full bg-brand text-brand-foreground hover:bg-brand/90 disabled:bg-white/15 disabled:text-white/60 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-white/70';
const BAR =
  'mx-auto flex h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-medium text-white hover:bg-white/15 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-white/70';

interface FooterProps {
  owner: PublicProfile;
  status: Status;
  /** Phone: the reply box is open (a tap on "Reply", or a swipe up). Wider screens always show it. */
  open: boolean;
  onOpen: (open: boolean) => void;
  /** Typing a reply: the status waits. */
  onTyping: (typing: boolean) => void;
}

/** Someone else's status: reply, or react with one tap. Both go to our 1:1 chat. */
export function ReplyFooter({ owner, status, open, onOpen, onTyping }: FooterProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);
  const send = async (work: () => Promise<unknown>) => {
    setSending(true);
    try {
      await work();
      toast.success(t('updates.replySent', { name: owner.displayName }));
      setText('');
      onOpen(false);
    } catch {
      toast.error(t('updates.replyFailed'));
    } finally {
      setSending(false);
    }
  };
  return (
    <div className="space-y-2">
      {/* Phone, closed: "Reply" with an arrow up (a swipe up on the picture opens it too). */}
      {open ? null : (
        <button
          type="button"
          className={cn(BAR, 'flex-col gap-0 md:hidden')}
          onClick={() => onOpen(true)}
        >
          <ChevronUp className="size-5" aria-hidden />
          {t('updates.reply')}
        </button>
      )}
      <div className={cn('space-y-2', open ? 'block' : 'hidden md:block')}>
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
            ref={input}
            id="status-reply"
            value={text}
            maxLength={4096}
            autoComplete="off"
            placeholder={t('updates.replyPlaceholder')}
            onChange={(event) => setText(event.target.value)}
            onFocus={() => onTyping(true)}
            onBlur={() => onTyping(false)}
            className="h-12 min-w-0 flex-1 rounded-full border border-white/25 bg-white/10 px-5 text-[15px] text-white backdrop-blur placeholder:text-white/75 focus-visible:border-white focus-visible:outline-none"
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
    </div>
  );
}

/** My own status: "Viewed by N", which opens who (a swipe up does too). Delete is in ⋯. */
export function OwnFooter(props: { status: Status; onViewers: () => void }) {
  const { t } = useTranslation();
  const count = props.status.viewCount;
  return (
    <button type="button" onClick={props.onViewers} className={cn(BAR, 'flex-col gap-0.5')}>
      <ChevronUp className="size-5" aria-hidden />
      <span className="flex items-center gap-2">
        <Eye className="size-5" aria-hidden />
        {count === null ? t('updates.viewedByHidden') : t('updates.viewedBy', { count })}
      </span>
    </button>
  );
}
