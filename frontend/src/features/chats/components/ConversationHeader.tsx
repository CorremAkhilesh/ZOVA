import { Link } from '@tanstack/react-router';
import { ArrowLeft, Info, Phone, Search, Video } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { formatListTime } from '../chat-utils';
import type { ChatSummary } from '../types';

interface ConversationHeaderProps {
  chat: ChatSummary;
  showBack: boolean;
  onToggleInfo: () => void;
  infoOpen: boolean;
}

export function ConversationHeader({
  chat,
  showBack,
  onToggleInfo,
  infoOpen,
}: ConversationHeaderProps) {
  const { t, i18n } = useTranslation();

  let subtitle: string;
  if (chat.kind === 'group') subtitle = t('conversation.members', { count: chat.memberCount ?? 0 });
  else if (chat.online) subtitle = t('conversation.online');
  else if (chat.lastSeenAt) {
    const time = formatListTime(
      chat.lastSeenAt,
      new Date(),
      i18n.language,
      t('conversation.yesterday'),
    );
    subtitle = t('conversation.lastSeen', { time });
  } else subtitle = '';

  return (
    <header className="glass flex h-16 shrink-0 items-center gap-2 border-b px-2 md:px-4">
      {showBack ? (
        <Button asChild variant="ghost" size="icon" aria-label={t('conversation.back')}>
          <Link to="/chats">
            <ArrowLeft className="size-5" />
          </Link>
        </Button>
      ) : null}
      <button
        type="button"
        onClick={onToggleInfo}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 text-left"
        aria-label={t('conversation.info')}
        aria-expanded={infoOpen}
      >
        <Avatar name={chat.name} online={chat.online === true} className="size-10" />
        <span className="min-w-0">
          <span className="block truncate font-semibold">{chat.name}</span>
          <span
            className={
              chat.online ? 'block text-xs text-accent-text' : 'block text-xs text-text-muted'
            }
          >
            {subtitle}
          </span>
        </span>
      </button>
      <div className="flex items-center">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('placeholder.callsTitle')}
          className="hidden sm:inline-flex"
        >
          <Video className="size-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('nav.calls')}
          className="hidden sm:inline-flex"
        >
          <Phone className="size-5" />
        </Button>
        <Button variant="ghost" size="icon" aria-label={t('chats.searchPlaceholder')}>
          <Search className="size-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('conversation.info')}
          aria-pressed={infoOpen}
          onClick={onToggleInfo}
          className="hidden lg:inline-flex"
        >
          <Info className="size-5" />
        </Button>
      </div>
    </header>
  );
}
