import { Link } from '@tanstack/react-router';
import { ArrowLeft, Info, Phone, Search, Video } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ComingSoonButton } from '@/components/common/ComingSoonButton';
import { Button } from '@/components/ui/button';
import type { ChatSummary } from '../types';
import { ChatAvatar } from './ChatAvatar';

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
  const { t } = useTranslation();

  let subtitle = '';
  if (chat.kind === 'saved') subtitle = t('chats.savedHint');
  else if (chat.kind === 'group')
    subtitle = t('conversation.members', { count: chat.memberCount ?? 0 });
  else if (chat.username) subtitle = `@${chat.username}`;

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
        <ChatAvatar chat={chat} className="size-10" />
        <span className="min-w-0">
          <span className="block truncate font-semibold">{chat.name}</span>
          <span className="block truncate text-xs text-text-muted">{subtitle}</span>
        </span>
      </button>
      <div className="flex items-center">
        <ComingSoonButton
          label={t('placeholder.callsTitle')}
          icon={Video}
          className="hidden sm:inline-flex"
        />
        <ComingSoonButton label={t('nav.calls')} icon={Phone} className="hidden sm:inline-flex" />
        <ComingSoonButton label={t('conversation.searchInChat')} icon={Search} />
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
