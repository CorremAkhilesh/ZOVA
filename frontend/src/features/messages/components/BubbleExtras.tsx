import { FORWARDED_MANY_TIMES } from '@zuvo/protocol';
import { Ban, CornerUpLeft, CornerUpRight, MoreHorizontal, Smile, Star } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/features/auth/session';
import { type ChatMessage, ME } from '@/features/chats/types';
import { useThumbnail } from '@/features/media/use-thumbnail';
import { cn } from '@/lib/utils';
import { groupReactions } from '../rules';
import { useMessageUi } from '../store';

export function ForwardedLabel({ message }: { message: ChatMessage }) {
  const { t } = useTranslation();
  if (!message.forwarded) return null;
  const many = (message.forwardCount ?? 0) >= FORWARDED_MANY_TIMES;
  return (
    <p className="mb-0.5 flex items-center gap-1 text-xs italic opacity-75">
      <CornerUpRight className="size-3" aria-hidden />
      {t(many ? 'messages.forwardedMany' : 'messages.forwarded')}
    </p>
  );
}

export function Tombstone({ message }: { message: ChatMessage }) {
  const { t } = useTranslation();
  return (
    <p className="flex items-center gap-1.5 pr-16 italic opacity-80">
      <Ban className="size-3.5 shrink-0" aria-hidden />
      {t(message.deletedByAdmin ? 'messages.deletedByAdmin' : 'messages.deleted')}
    </p>
  );
}

/** The same small picture the original shows. One the reader may not open simply stays out. */
function QuoteThumb({ mediaId }: { mediaId: string }) {
  const { url } = useThumbnail(mediaId, true);
  if (!url) return null;
  return <img src={url} alt="" className="size-10 shrink-0 rounded object-cover" />;
}

/** The quoted message. Takes you to the original when it is in this chat and still there. */
export function QuoteBlock({ message, mine }: { message: ChatMessage; mine: boolean }) {
  const { t } = useTranslation();
  const me = useSession()?.user.id;
  const quote = message.replyTo;
  if (!quote) return null;
  const jumpable = quote.chatId === message.chatId && !quote.deleted && !quote.unavailable;
  const who = quote.senderId === me ? t('chats.you') : quote.senderName;
  const body = quote.deleted
    ? t('messages.deleted')
    : quote.unavailable
      ? t('messages.quoteUnavailable')
      : quote.text;
  const content = (
    <>
      <span className="min-w-0 flex-1">
        {who ? <span className="block font-semibold">{who}</span> : null}
        <span className="line-clamp-2 opacity-90">{body}</span>
      </span>
      {quote.mediaId && quote.hasThumbnail ? <QuoteThumb mediaId={quote.mediaId} /> : null}
    </>
  );
  const style = cn(
    'mb-1 flex w-full items-center gap-2 rounded-lg border-l-4 px-2 py-1 text-left text-xs',
    mine
      ? 'border-bubble-outgoing-meta bg-black/15 text-bubble-outgoing-text'
      : 'border-brand bg-background text-bubble-incoming-text',
  );
  if (!jumpable) return <div className={style}>{content}</div>;
  return (
    <button
      type="button"
      className={style}
      aria-label={t('messages.jumpToQuote', { name: who, text: body })}
      onClick={(event) => {
        event.stopPropagation();
        useMessageUi.getState().set({ jump: { chatId: quote.chatId, seq: quote.seq } });
      }}
    >
      {content}
    </button>
  );
}

export function ReactionPills({ message }: { message: ChatMessage }) {
  const { t } = useTranslation();
  const me = useSession()?.user.id;
  const groups = groupReactions(message.reactions ?? []);
  if (groups.length === 0) return null;
  return (
    <ul
      aria-label={t('messages.reactions')}
      className={cn(
        '-mt-1.5 relative z-10 flex flex-wrap gap-1 px-1',
        message.authorId === ME && 'justify-end',
      )}
    >
      {groups.map(({ emoji, userIds }) => (
        <li key={emoji}>
          <button
            type="button"
            aria-label={t('messages.reactedWith', { emoji, count: userIds.length })}
            onClick={(event) => {
              event.stopPropagation();
              useMessageUi.getState().set({ whoReacted: message });
            }}
            className={cn(
              'flex items-center gap-1 rounded-full border bg-surface px-1.5 py-0.5 text-xs shadow-sm',
              me && userIds.includes(me) && 'border-brand bg-brand-subtle',
            )}
          >
            <span aria-hidden>{emoji}</span>
            <span className="tabular-nums text-text-muted">{userIds.length}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function StarMark({ message }: { message: ChatMessage }) {
  const { t } = useTranslation();
  if (!message.starred) return null;
  return (
    <Star
      role="img"
      aria-label={t('messages.starred')}
      className="size-3 fill-current opacity-70"
    />
  );
}

/** On a device with a mouse: reply, react, and everything else, next to the bubble. */
export function HoverActions(props: {
  onReply: () => void;
  onMenu: (x: number, y: number) => void;
}) {
  const { t } = useTranslation();
  const style =
    'rounded-full p-1 text-text-muted hover:bg-background hover:text-text focus-visible:opacity-100';
  const atButton = (event: React.MouseEvent) => {
    const box = event.currentTarget.getBoundingClientRect();
    props.onMenu(box.left, box.bottom);
  };
  return (
    <div className="flex items-center self-center opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100 pointer-coarse:hidden">
      <button
        type="button"
        className={style}
        aria-label={t('messages.reply')}
        onClick={props.onReply}
      >
        <CornerUpLeft className="size-4" aria-hidden />
      </button>
      <button type="button" className={style} aria-label={t('messages.react')} onClick={atButton}>
        <Smile className="size-4" aria-hidden />
      </button>
      <button type="button" className={style} aria-label={t('messages.more')} onClick={atButton}>
        <MoreHorizontal className="size-4" aria-hidden />
      </button>
    </div>
  );
}
