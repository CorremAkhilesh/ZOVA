import { Link } from '@tanstack/react-router';
import { BellOff, Pin } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatListTime } from '../chat-utils';
import { type ChatSummary, ME } from '../types';
import { DeliveryTicks } from './DeliveryTicks';

export function ChatListItem({ chat, now }: { chat: ChatSummary; now: Date }) {
  const { t, i18n } = useTranslation();
  const { lastMessage } = chat;
  const fromMe = lastMessage.authorId === ME;
  const time = formatListTime(lastMessage.at, now, i18n.language, t('conversation.yesterday'));
  const authorPrefix =
    chat.kind === 'group' && !fromMe ? `${lastMessage.authorName.split(' ')[0]}: ` : '';

  return (
    <Link
      to="/chats/$chatId"
      params={{ chatId: chat.id }}
      className={cn(
        'group flex items-center gap-3 rounded-xl px-3 py-2.5 outline-none transition-colors',
        'hover:bg-background focus-visible:bg-background',
        'data-[status=active]:bg-brand-subtle',
      )}
    >
      <Avatar name={chat.name} online={chat.online === true} />
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
          {fromMe && lastMessage.status ? (
            <DeliveryTicks status={lastMessage.status} className="text-text-muted" />
          ) : null}
          <p className="min-w-0 flex-1 truncate text-sm text-text-muted">
            {authorPrefix}
            {lastMessage.text}
          </p>
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
        </div>
      </div>
    </Link>
  );
}
