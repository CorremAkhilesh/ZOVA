import type { SystemEvent } from '@zuvo/protocol';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { MessageInfoButton } from '@/features/groups/components/MessageInfoButton';
import { systemText } from '@/features/groups/wording';
import { UploadNotice } from '@/features/media/components/UploadNotice';
import {
  BubbleHoverActions,
  ForwardedLabel,
  QuoteBlock,
  ReactionPills,
  Tombstone,
} from '@/features/messages/components/BubbleExtras';
import { canOpenMenu } from '@/features/messages/rules';
import { useMessageUi } from '@/features/messages/store';
import { useBubbleGestures } from '@/features/messages/use-bubble-gestures';
import { PollCard } from '@/features/polls/components/PollCard';
import { StatusQuote } from '@/features/status/components/StatusQuote';
import { cn } from '@/lib/utils';
import { senderColorClass } from '../sender-color';
import { type ChatMessage, ME } from '../types';
import { useMyId } from '../use-my-id';
import { BubbleContent, MessageMeta } from './BubbleParts';

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
  /** A system line repeated this many times in a row. */
  repeat?: number;
  /** The list took the reader here, so it stands out for a moment. */
  highlighted?: boolean;
}

/** The first bubble of a group has the tail, so its top corner on that side is square. */
function bubbleCorners(mine: boolean, first: boolean): string {
  // Literal class names so Tailwind can find them.
  if (!first) return '';
  return mine ? 'rounded-tr-none' : 'rounded-tl-none';
}

/** Small tail at the top of the first bubble of a group, pointing at its sender. */
function BubbleTail({ mine }: { mine: boolean }) {
  return (
    <svg
      aria-hidden
      data-testid="bubble-tail"
      viewBox="0 0 8 13"
      className={cn(
        'absolute top-0 h-[13px] w-2',
        mine ? '-right-2 text-bubble-outgoing' : '-left-2 -scale-x-100 text-bubble-incoming',
      )}
    >
      <path d="M0 0h8C5 2 1.5 6 0 13Z" fill="currentColor" />
    </svg>
  );
}

function SystemPill({ event, repeat = 1 }: { event: SystemEvent; repeat?: number | undefined }) {
  const { t } = useTranslation();
  const me = useMyId() ?? '';
  return (
    <p className="mx-auto my-1.5 w-fit max-w-[90%] rounded-lg bg-surface px-2.5 py-0.5 text-center text-xs leading-5 text-text-muted shadow-sm">
      {systemText(event, me, t)}
      {repeat > 1 ? ` (${repeat})` : null}
    </p>
  );
}

export function MessageBubble(props: MessageBubbleProps) {
  if (props.message.system) {
    return <SystemPill event={props.message.system} repeat={props.repeat} />;
  }
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
  const { message, firstInGroup, isGroup, onOpenMedia, album, mine } = props;
  return (
    <div
      // Which side it is on decides the colours inside it (mentions: globals.css).
      data-bubble={mine ? 'out' : 'in'}
      className={cn(
        'relative rounded-lg px-[9px] pt-1.5 pb-2 text-[15px] leading-[1.4] shadow-[0_1px_0.5px_rgb(0_0_0/0.13)] md:text-[14.5px]',
        mine
          ? 'bg-bubble-outgoing text-bubble-outgoing-text'
          : 'bg-bubble-incoming text-bubble-incoming-text',
        bubbleCorners(mine, firstInGroup),
      )}
    >
      {firstInGroup ? <BubbleTail mine={mine} /> : null}
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
          <StatusQuote message={message} mine={mine} />
          {message.poll ? (
            <PollCard message={message} />
          ) : (
            <BubbleContent message={message} mine={mine} album={album} onOpenMedia={onOpenMedia} />
          )}
        </>
      )}
      <MessageMeta message={message} mine={mine} />
    </div>
  );
}

function rowClass(row: {
  mine: boolean;
  firstInGroup: boolean;
  lastInGroup: boolean;
  selected: boolean;
  selecting: boolean;
  highlighted: boolean | undefined;
}) {
  return cn(
    'group/message flex items-end gap-2 rounded-xl outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand/40',
    row.mine ? 'justify-end' : 'justify-start',
    // One sender's run sits close together (2 px); a new sender or a pause gets room (10 px).
    row.lastInGroup ? 'mb-2.5' : 'mb-0.5',
    // The tail sticks out by 8 px: room for it on the first bubble of a run.
    row.mine ? 'pr-2' : 'pl-2',
    row.selected && 'bg-brand/15',
    row.highlighted && 'bg-brand/25',
    row.selecting && 'cursor-pointer',
  );
}

function UserBubble(props: MessageBubbleProps) {
  const { message, firstInGroup, lastInGroup, isGroup, chatId, onRetry, album, highlighted } =
    props;
  const mine = message.authorId === ME;
  const gestures = useBubbleGestures(message, album ?? [message]);
  const selecting = useMessageUi((state) => state.selecting !== null);
  const selected = useMessageUi((state) => state.selected.some((item) => item.id === message.id));
  const canUse = canOpenMenu(message);
  const actions =
    canUse && !selecting ? <BubbleHoverActions message={message} gestures={gestures} /> : null;

  return (
    // No entrance animation: rows re-enter the page each time they are scrolled back into view.
    <div
      {...gestures.handlers}
      tabIndex={canUse ? 0 : undefined}
      data-seq={message.seq ?? undefined}
      className={rowClass({ mine, firstInGroup, lastInGroup, selected, selecting, highlighted })}
    >
      {selecting && canUse ? <SelectMark selected={selected} /> : null}
      {isGroup && !mine ? <AvatarColumn message={message} show={lastInGroup} /> : null}
      {mine && chatId && message.serverId ? (
        <MessageInfoButton chatId={chatId} messageId={message.serverId} />
      ) : null}
      {mine ? actions : null}
      <div
        // Phone ~80 %, desktop ~65 %, and never a wall of text on a wide screen.
        className="min-w-0 max-w-[min(80%,30rem)] md:max-w-[min(65%,38rem)]"
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
