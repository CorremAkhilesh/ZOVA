import { motion } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { formatClock } from '../chat-utils';
import { type ChatMessage, ME } from '../types';
import { DeliveryTicks } from './DeliveryTicks';

/** Tighter corners on the side of the group "spine"; a small tail corner on the last bubble. */
function bubbleCorners(mine: boolean, first: boolean, last: boolean): string {
  // Literal class names so Tailwind can find them.
  if (mine) return cn(!first && 'rounded-tr-md', last ? 'rounded-br-sm' : 'rounded-br-md');
  return cn(!first && 'rounded-tl-md', last ? 'rounded-bl-sm' : 'rounded-bl-md');
}

interface MessageBubbleProps {
  message: ChatMessage;
  firstInGroup: boolean;
  lastInGroup: boolean;
  showAuthor: boolean;
}

export function MessageBubble({
  message,
  firstInGroup,
  lastInGroup,
  showAuthor,
}: MessageBubbleProps) {
  const { t, i18n } = useTranslation();
  const mine = message.author === ME;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.2, ease: [0.2, 0, 0, 1] }}
      className={cn(
        'flex',
        mine ? 'justify-end' : 'justify-start',
        lastInGroup ? 'mb-2' : 'mb-0.5',
      )}
    >
      <div
        className={cn(
          'relative max-w-[min(78%,34rem)] rounded-2xl px-3 py-1.5 text-[15px] leading-snug shadow-sm',
          mine
            ? 'bg-bubble-outgoing text-bubble-outgoing-text'
            : 'bg-bubble-incoming text-bubble-incoming-text',
          bubbleCorners(mine, firstInGroup, lastInGroup),
        )}
      >
        {showAuthor && firstInGroup && !mine ? (
          <p className="mb-0.5 text-xs font-semibold text-brand-text">{message.author}</p>
        ) : null}
        {message.replyTo ? (
          <div
            className={cn(
              'mb-1 rounded-lg border-l-4 px-2 py-1 text-xs',
              mine
                ? 'border-bubble-outgoing-meta bg-black/15 text-bubble-outgoing-text'
                : 'border-brand bg-background text-bubble-incoming-text',
            )}
          >
            <p className="font-semibold">
              {message.replyTo.author === ME ? t('chats.you') : message.replyTo.author}
            </p>
            <p className="line-clamp-2 opacity-90">{message.replyTo.text}</p>
          </div>
        ) : null}
        <p className="whitespace-pre-wrap break-words">
          {message.text}
          {/* Reserve room so the timestamp never overlaps the last line. */}
          <span className="inline-block w-16" aria-hidden />
        </p>
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
      </div>
    </motion.div>
  );
}
