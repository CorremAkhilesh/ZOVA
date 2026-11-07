import type { SystemEvent } from '@zuvo/protocol';
import { Check, Mic } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { useSession } from '@/features/auth/session';
import { FormattedText } from '@/features/formatting/FormattedText';
import { MessageInfoButton } from '@/features/groups/components/MessageInfoButton';
import { systemText } from '@/features/groups/wording';
import { LinkPreviewCard } from '@/features/link-previews/LinkPreviewCard';
import { AlbumGrid, MessageMedia } from '@/features/media/components/MessageMedia';
import { UploadNotice } from '@/features/media/components/UploadNotice';
import {
  ForwardedLabel,
  HoverActions,
  QuoteBlock,
  ReactionPills,
  StarMark,
  Tombstone,
} from '@/features/messages/components/BubbleExtras';
import { canAct } from '@/features/messages/rules';
import { useMessageUi } from '@/features/messages/store';
import { useBubbleGestures } from '@/features/messages/use-bubble-gestures';
import { useInChatSearch } from '@/features/search/in-chat-store';
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
  /** Offers "Message info" on my own messages. */
  chatId?: string | undefined;
  onRetry?: (clientMsgId: string) => void;
  onOpenMedia?: ((mediaId: string) => void) | undefined;
  /** Every item of an album, when this bubble shows one. */
  album?: ChatMessage[] | undefined;
  /** The list took the reader here, so it stands out for a moment. */
  highlighted?: boolean;
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
      <StarMark message={message} />
      {message.edited && !message.deleted ? <span>{t('messages.edited')}</span> : null}
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
  const highlight = useInChatSearch((state) => (state.chatId === message.chatId ? state.term : ''));
  // Reserve room so the time, and my tick, never overlap the last line.
  const room = (
    <span
      className={cn(
        'inline-block',
        mine ? 'w-[5.25rem]' : 'w-16',
        message.edited && 'ml-10',
        message.starred && 'ml-4',
      )}
      aria-hidden
    />
  );
  return (
    <>
      {album ? <AlbumGrid items={album} onOpen={onOpenMedia} /> : null}
      {!album && message.media ? <MessageMedia message={message} onOpen={onOpenMedia} /> : null}
      {message.linkPreview && !message.deleted ? (
        <LinkPreviewCard preview={message.linkPreview} mine={mine} />
      ) : null}
      {caption || !hasMedia ? (
        <FormattedText
          text={caption ?? ''}
          highlight={highlight}
          trailing={room}
          className={cn('break-words', hasMedia && 'mt-1')}
        />
      ) : (
        <div className="h-5" />
      )}
    </>
  );
}

function SystemPill({ event }: { event: SystemEvent }) {
  const { t } = useTranslation();
  const me = useSession()?.user.id ?? '';
  return (
    <p className="mx-auto mb-3 w-fit max-w-[90%] rounded-full bg-surface/80 px-3 py-1 text-center text-xs text-text-muted shadow-sm">
      {systemText(event, me, t)}
    </p>
  );
}

export function MessageBubble(props: MessageBubbleProps) {
  if (props.message.system) return <SystemPill event={props.message.system} />;
  return <UserBubble {...props} />;
}

function SelectMark({ selected }: { selected: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      role="img"
      aria-label={t(selected ? 'messages.isSelected' : 'messages.notSelected')}
      className={cn(
        'mr-auto flex size-5 shrink-0 items-center justify-center self-center rounded-full border-2',
        selected ? 'border-brand bg-brand text-brand-foreground' : 'border-text-muted',
      )}
    >
      {selected ? <Check className="size-3.5" aria-hidden /> : null}
    </span>
  );
}

function AvatarColumn({ message, show }: { message: ChatMessage; show: boolean }) {
  return (
    <div className="w-7 shrink-0">
      {show ? (
        <Avatar
          name={message.authorName}
          src={message.authorAvatar}
          className="size-7 text-[10px]"
        />
      ) : null}
    </div>
  );
}

function BubbleBody(props: MessageBubbleProps & { mine: boolean }) {
  const { message, firstInGroup, lastInGroup, isGroup, onOpenMedia, album, mine } = props;
  return (
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
      {message.deleted ? (
        <Tombstone message={message} />
      ) : (
        <>
          <ForwardedLabel message={message} />
          <QuoteBlock message={message} mine={mine} />
          <BubbleContent message={message} mine={mine} album={album} onOpenMedia={onOpenMedia} />
        </>
      )}
      <MessageMeta message={message} mine={mine} />
    </div>
  );
}

function rowClass(row: {
  mine: boolean;
  lastInGroup: boolean;
  selected: boolean;
  selecting: boolean;
  highlighted: boolean | undefined;
}) {
  return cn(
    'group/message flex items-end gap-2 rounded-xl outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/40',
    row.mine ? 'justify-end' : 'justify-start',
    row.lastInGroup ? 'mb-3' : 'mb-[3px]',
    row.selected && 'bg-brand/15',
    row.highlighted && 'bg-brand/25',
    row.selecting && 'cursor-pointer',
  );
}

function UserBubble(props: MessageBubbleProps) {
  const { message, lastInGroup, isGroup, chatId, onRetry, album, highlighted } = props;
  const mine = message.authorId === ME;
  const gestures = useBubbleGestures(message, album ?? [message]);
  const selecting = useMessageUi((state) => state.selecting !== null);
  const selected = useMessageUi((state) => state.selected.some((item) => item.id === message.id));
  const canUse = canAct(message);
  const actions =
    canUse && !selecting ? (
      <HoverActions onReply={gestures.reply} onMenu={gestures.openMenu} />
    ) : null;

  return (
    // No entrance animation: rows re-enter the page each time they are scrolled back into view.
    <div
      {...gestures.handlers}
      tabIndex={canUse ? 0 : undefined}
      data-seq={message.seq ?? undefined}
      className={rowClass({ mine, lastInGroup, selected, selecting, highlighted })}
    >
      {selecting && canUse ? <SelectMark selected={selected} /> : null}
      {isGroup && !mine ? <AvatarColumn message={message} show={lastInGroup} /> : null}
      {mine && chatId && message.serverId ? (
        <MessageInfoButton chatId={chatId} messageId={message.serverId} />
      ) : null}
      {mine ? actions : null}
      <div
        className="max-w-[min(78%,34rem)]"
        style={gestures.swipe ? { transform: `translateX(${gestures.swipe}px)` } : undefined}
      >
        <BubbleBody {...props} mine={mine} />
        <ReactionPills message={message} />
        <UploadNotice message={message} onRetry={onRetry} />
      </div>
      {mine ? null : actions}
    </div>
  );
}
