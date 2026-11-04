import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
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
  const { i18n } = useTranslation();
  return (
    <span
      className={cn(
        'absolute right-2.5 bottom-1 flex items-center gap-1 text-[11px] tabular-nums',
        mine ? 'text-bubble-outgoing-meta' : 'text-bubble-incoming-meta',
      )}
    >
      <time dateTime={message.at.toISOString()}>{formatClock(message.at, i18n.language)}</time>
      {mine && message.status ? (
        <DeliveryTicks
          status={message.status}
          className={cn('size-3.5', message.status === 'read' && 'text-bubble-outgoing-read')}
        />
      ) : null}
    </span>
  );
}

/** "Not sent — tap to retry", under the bubble. */
function RetryButton({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onRetry}
      className="mt-0.5 block w-full text-right text-xs font-semibold text-danger"
    >
      {t('conversation.notSentRetry')}
    </button>
  );
}

export function MessageBubble({
  message,
  firstInGroup,
  lastInGroup,
  isGroup,
  onRetry,
}: MessageBubbleProps) {
  const { clientMsgId } = message;
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
          <p className="whitespace-pre-wrap break-words">
            {message.text}
            {/* Reserve room so the time, and my tick, never overlap the last line. */}
            <span className={cn('inline-block', mine ? 'w-[5.25rem]' : 'w-16')} aria-hidden />
          </p>
          <MessageMeta message={message} mine={mine} />
        </div>
        {message.status === 'failed' && clientMsgId && onRetry ? (
          <RetryButton onRetry={() => onRetry(clientMsgId)} />
        ) : null}
      </div>
    </div>
  );
}
