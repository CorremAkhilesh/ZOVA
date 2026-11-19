import { Mic } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExpiryMark, expiryRoom } from '@/features/disappearing/ExpiryMark';
import { FormattedText } from '@/features/formatting/FormattedText';
import { LinkPreviewCard } from '@/features/link-previews/LinkPreviewCard';
import { AlbumGrid, MessageMedia } from '@/features/media/components/MessageMedia';
import { openMentionProfile, useMentionMarks } from '@/features/mentions/mention-marks';
import { StarMark } from '@/features/messages/components/BubbleExtras';
import { useInChatSearch } from '@/features/search/in-chat-store';
import { cn } from '@/lib/utils';
import { formatClock } from '../chat-utils';
import { readMoreCut } from '../read-more';
import type { ChatMessage } from '../types';
import { DeliveryTicks } from './DeliveryTicks';

/** Time and, for my messages, delivery ticks in the bubble's bottom-right corner. */
export function MessageMeta({ message, mine }: { message: ChatMessage; mine: boolean }) {
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
      <ExpiryMark expiresAt={message.expiresAt} />
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

/** Room at the end of the last line, so the time and my tick never overlap the text. */
function MetaRoom({ message, mine }: { message: ChatMessage; mine: boolean }) {
  return (
    <span
      className={cn(
        'inline-block',
        mine ? 'w-[5.25rem]' : 'w-16',
        message.edited && 'ml-10',
        message.starred && 'ml-4',
        expiryRoom(message.expiresAt),
      )}
      aria-hidden
    />
  );
}

/** The text: whole, or (when very long) its start and "Read more", which shows it whole. */
function Caption(props: {
  message: ChatMessage;
  mine: boolean;
  text: string;
  afterMedia: boolean;
}) {
  const { message, mine, text } = props;
  const { t } = useTranslation();
  const highlight = useInChatSearch((state) => (state.chatId === message.chatId ? state.term : ''));
  const mentions = useMentionMarks(message.chatId, text, message.mentions);
  const [expanded, setExpanded] = useState(false);
  const cut = expanded ? null : readMoreCut(text);
  const room = <MetaRoom message={message} mine={mine} />;
  return (
    <>
      <FormattedText
        text={cut ?? text}
        highlight={highlight}
        mentions={mentions}
        onMention={openMentionProfile}
        trailing={cut ? undefined : room}
        className={cn(props.afterMedia && 'mt-1')}
      />
      {cut ? (
        <p>
          <button
            type="button"
            className="font-semibold underline underline-offset-2"
            onClick={(event) => {
              event.stopPropagation();
              setExpanded(true);
            }}
          >
            {t('messages.readMore')}
          </button>
          {room}
        </p>
      ) : null}
    </>
  );
}

/** Media and its caption, or text, always leaving room for the time in the corner. */
export function BubbleContent(props: {
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
      {message.linkPreview && !message.deleted ? (
        <LinkPreviewCard preview={message.linkPreview} mine={mine} />
      ) : null}
      {caption || !hasMedia ? (
        <Caption message={message} mine={mine} text={caption ?? ''} afterMedia={hasMedia} />
      ) : (
        <div className="h-5" />
      )}
    </>
  );
}
