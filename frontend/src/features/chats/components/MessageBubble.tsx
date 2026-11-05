import { Mic } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { AlbumGrid, MessageMedia } from '@/features/media/components/MessageMedia';
import { UploadNotice } from '@/features/media/components/UploadNotice';
import { cn } from '@/lib/utils';
import { formatClock } from '../chat-utils';
import { senderColorClass } from '../sender-color';
import { type ChatMessage, ME } from '../types';
import { DeliveryTicks } from './DeliveryTicks';

interface MessageBubbleProps {
  message: ChatMessage;
  firstInGroup: boolean;
  lastInGroup: boolean;
  /** Group chats: sender names, sender colors and avatars for incoming messages. */
  isGroup: boolean;
  onRetry?: (clientMsgId: string) => void;
  onOpenMedia?: ((mediaId: string) => void) | undefined;
  /** Every item of an album, when this bubble shows one. */
  album?: ChatMessage[] | undefined;
}

/** Tighter corners along the group "spine"; the last bubble's tail corner is square. */
function bubbleCorners(mine: boolean, first: boolean, last: boolean): string {
  // Literal class names so Tailwind can find them.
  if (mine) return cn(!first && 'rounded-tr-md', last ? 'rounded-br-none' : 'rounded-br-md');
  return cn(!first && 'rounded-tl-md', last ? 'rounded-bl-none' : 'rounded-bl-md');
}

/** Small curved tail on the last bubble of a group. */
function BubbleTail({ mine }: { mine: boolean }) {
  return (
    <svg
      aria-hidden
      data-testid="bubble-tail"
      viewBox="0 0 8 13"
      className={cn(
        'absolute bottom-0 h-[13px] w-2',
        mine ? '-right-2 text-bubble-outgoing' : '-left-2 -scale-x-100 text-bubble-incoming',
      )}
    >
      <path d="M0 0v13h8C4.5 11.5 1 8 0 0Z" fill="currentColor" />
    </svg>
  );
}

function ReplyQuote({
  reply,
  mine,
}: {
  reply: NonNullable<ChatMessage['replyTo']>;
  mine: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        'mb-1 rounded-lg border-l-4 px-2 py-1 text-xs',
        mine
          ? 'border-bubble-outgoing-meta bg-black/15 text-bubble-outgoing-text'
          : 'border-brand bg-background text-bubble-incoming-text',
      )}
    >
      <p className="font-semibold">{reply.authorId === ME ? t('chats.you') : reply.authorName}</p>
      <p className="line-clamp-2 opacity-90">{reply.text}</p>
    </div>
  );
}

/** Time and, for my messages, delivery ticks in the bubble's bottom-right corner. */
function MessageMeta({ message, mine }: { message: ChatMessage; mine: boolean }) {
  const { t, i18n } = useTranslation();
  return (
    <span
      className={cn(
        'absolute right-2.5 bottom-1 flex items-center gap-1 text-[11px] tabular-nums',
        mine ? 'text-bubble-outgoing-meta' : 'text-bubble-incoming-meta',
      )}
    >
      <time dateTime={message.at.toISOString()}>{formatClock(message.at, i18n.language)}</time>
      {mine && message.media?.kind === 'voice' ? (
        <Mic
          role="img"
          aria-label={t(message.played ? 'voice.played' : 'voice.notPlayed')}
          className={cn('size-3.5', message.played && 'text-bubble-outgoing-read')}
        />
      ) : null}
      {mine && message.status ? (
        <DeliveryTicks
          status={message.status}
          className="size-3.5"
          readClassName="text-bubble-outgoing-read"
        />
      ) : null}
    </span>
  );
}

/** Media and its caption, or text, always leaving room for the time in the corner. */
function BubbleContent(props: {
  message: ChatMessage;
  mine: boolean;
  album: ChatMessage[] | undefined;
  onOpenMedia: ((mediaId: string) => void) | undefined;
}) {
  const { message, mine, album, onOpenMedia } = props;
  const hasMedia = Boolean(album || message.media);
  const caption = album ? album.find((item) => item.text)?.text : message.text;
  return (
    <>
      {album ? <AlbumGrid items={album} onOpen={onOpenMedia} /> : null}
      {!album && message.media ? <MessageMedia message={message} onOpen={onOpenMedia} /> : null}
      {caption || !hasMedia ? (
        <p className={cn('whitespace-pre-wrap break-words', hasMedia && 'mt-1')}>
          {caption}
          {/* Reserve room so the time, and my tick, never overlap the last line. */}
          <span className={cn('inline-block', mine ? 'w-[5.25rem]' : 'w-16')} aria-hidden />
        </p>
      ) : (
        <div className="h-5" />
      )}
    </>
  );
}

export function MessageBubble({
  message,
  firstInGroup,
  lastInGroup,
  isGroup,
  onRetry,
  onOpenMedia,
  album,
}: MessageBubbleProps) {
  const mine = message.authorId === ME;
  const showAvatarColumn = isGroup && !mine;

  return (
    // No entrance animation: rows re-enter the page each time they are scrolled back into view.
    <div
      className={cn(
        'flex items-end gap-2',
        mine ? 'justify-end' : 'justify-start',
        lastInGroup ? 'mb-3' : 'mb-[3px]',
      )}
    >
      {showAvatarColumn ? (
        <div className="w-7 shrink-0">
          {lastInGroup ? <Avatar name={message.authorName} className="size-7 text-[10px]" /> : null}
        </div>
      ) : null}
      <div className="max-w-[min(78%,34rem)]">
        <div
          className={cn(
            'relative rounded-2xl px-3 py-1.5 text-[15px] leading-snug shadow-sm',
            mine
              ? 'bg-bubble-outgoing text-bubble-outgoing-text'
              : 'bg-bubble-incoming text-bubble-incoming-text',
            bubbleCorners(mine, firstInGroup, lastInGroup),
          )}
        >
          {lastInGroup ? <BubbleTail mine={mine} /> : null}
          {isGroup && firstInGroup && !mine ? (
            <p className={cn('mb-0.5 text-xs font-semibold', senderColorClass(message.authorId))}>
              {message.authorName}
            </p>
          ) : null}
          {message.replyTo ? <ReplyQuote reply={message.replyTo} mine={mine} /> : null}
          <BubbleContent message={message} mine={mine} album={album} onOpenMedia={onOpenMedia} />
          <MessageMeta message={message} mine={mine} />
        </div>
        <UploadNotice message={message} onRetry={onRetry} />
      </div>
    </div>
  );
}
