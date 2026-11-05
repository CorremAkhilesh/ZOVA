import { Link } from '@tanstack/react-router';
import { BellOff, Pin } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { useLiveStatus } from '@/features/sync/live-status';
import { usePresenceWatchWhileVisible } from '@/features/sync/presence-watch';
import { cn } from '@/lib/utils';
import { formatListTime } from '../chat-utils';
import { type ChatSummary, ME } from '../types';
import { ChatAvatar } from './ChatAvatar';
import { DeliveryTicks } from './DeliveryTicks';
import { TypingIndicator } from './TypingIndicator';

/** In Saved Messages everything is mine, so a prefix would say nothing. */
function previewPrefix(chat: ChatSummary, you: string): string {
  const { lastMessage, kind } = chat;
  if (!lastMessage || kind === 'saved') return '';
  if (lastMessage.authorId === ME) return `${you}: `;
  return kind === 'group' ? `${lastMessage.authorName.split(' ')[0]}: ` : '';
}

/** The second line: "typing…", or the last message with its tick and prefix. */
function Preview({ chat, typing }: { chat: ChatSummary; typing: boolean }) {
  const { t } = useTranslation();
  const { lastMessage } = chat;
  if (typing) {
    return (
      <p className="min-w-0 flex-1 truncate text-sm">
        <TypingIndicator />
      </p>
    );
  }
  return (
    <>
      {lastMessage?.status && chat.kind !== 'saved' ? (
        <DeliveryTicks status={lastMessage.status} className="text-text-muted" />
      ) : null}
      <p className="min-w-0 flex-1 truncate text-sm text-text-muted">
        {lastMessage
          ? `${previewPrefix(chat, t('chats.you'))}${lastMessage.text}`
          : t(chat.kind === 'saved' ? 'chats.savedHint' : 'chats.noMessages')}
      </p>
    </>
  );
}

function Markers({ chat }: { chat: ChatSummary }) {
  const { t } = useTranslation();
  return (
    <>
      {chat.muted ? (
        <BellOff
          className="size-4 shrink-0 text-text-muted"
          role="img"
          aria-label={t('chats.muted')}
        />
      ) : null}
      {chat.pinned ? (
        <Pin
          className="size-4 shrink-0 rotate-45 text-text-muted"
          role="img"
          aria-label={t('chats.pinned')}
        />
      ) : null}
      {chat.unread > 0 ? (
        <Badge
          variant={chat.muted ? 'muted' : 'brand'}
          aria-label={t('chats.unread', { count: chat.unread })}
        >
          {chat.unread}
        </Badge>
      ) : null}
    </>
  );
}

export function ChatListItem({ chat, now }: { chat: ChatSummary; now: Date }) {
  const { t, i18n } = useTranslation();
  const { lastMessage } = chat;
  const time = lastMessage
    ? formatListTime(lastMessage.at, now, i18n.language, t('conversation.yesterday'))
    : '';
  const row = useRef<HTMLAnchorElement>(null);
  usePresenceWatchWhileVisible(row, chat.otherUserId);
  const typing = useLiveStatus((state) => state.typing[chat.id] === true);
  const online = useLiveStatus((state) =>
    chat.otherUserId ? state.presence[chat.otherUserId]?.online === true : false,
  );

  return (
    <Link
      ref={row}
      to="/chats/$chatId"
      params={{ chatId: chat.id }}
      className={cn(
        'group flex items-center gap-3 rounded-xl px-3 py-2.5 outline-none transition-colors',
        'hover:bg-background focus-visible:bg-background',
        'data-[status=active]:bg-brand-subtle',
      )}
    >
      <ChatAvatar chat={chat} online={online} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate font-semibold text-text">{chat.name}</span>
          <span
            className={cn(
              'shrink-0 text-xs',
              chat.unread > 0 && !chat.muted ? 'font-semibold text-brand-text' : 'text-text-muted',
            )}
          >
            {time}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <Preview chat={chat} typing={typing} />
          <Markers chat={chat} />
        </div>
      </div>
    </Link>
  );
}
