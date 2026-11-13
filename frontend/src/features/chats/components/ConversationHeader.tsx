import { Link } from '@tanstack/react-router';
import type { GroupMember } from '@zuvo/protocol';
import { ArrowLeft, Info, Phone, Search, Video } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ComingSoonButton } from '@/components/common/ComingSoonButton';
import { Button } from '@/components/ui/button';
import { useSession } from '@/features/auth/session';
import { ConnectionStatus } from '@/features/connection/ConnectionStatus';
import { DisappearingBadge } from '@/features/disappearing/DisappearingBadge';
import { memberNames, typingLine } from '@/features/groups/wording';
import { ScheduledButton } from '@/features/scheduled/components/ScheduledButton';
import { useInChatSearch } from '@/features/search/in-chat-store';
import { useLiveStatus } from '@/features/sync/live-status';
import { usePresenceWatch, usePresenceWatchMany } from '@/features/sync/presence-watch';
import { cn } from '@/lib/utils';
import { statusLine } from '../status-line';
import type { ChatSummary } from '../types';
import { ChatAvatar } from './ChatAvatar';
import { TypingIndicator } from './TypingIndicator';

interface ConversationHeaderProps {
  chat: ChatSummary;
  showBack: boolean;
  onToggleInfo: () => void;
  infoOpen: boolean;
  members?: GroupMember[] | undefined;
}

/** A group's second line: who is in it, who is online and who is typing. */
function useGroupLine(
  chat: ChatSummary,
  members: GroupMember[] | undefined,
  typingIds: string[] | undefined,
) {
  const { t } = useTranslation();
  const me = useSession()?.user.id ?? '';
  const memberIds = useMemo(() => (members ?? []).map((member) => member.user.id), [members]);
  const others = useMemo(() => memberIds.filter((id) => id !== me), [me, memberIds]);
  usePresenceWatchMany(others);
  const onlineCount = useLiveStatus(
    (state) => others.filter((id) => state.presence[id]?.online).length,
  );
  if (chat.kind !== 'group') return { subtitle: null, typingLabel: undefined, onlineCount: 0 };
  const nameOf = (id: string) =>
    members?.find((member) => member.user.id === id)?.user.displayName ?? t('chats.unknownPerson');
  return {
    subtitle:
      (members && memberNames(members, me, t('groups.you'))) ||
      t('conversation.members', { count: chat.memberCount ?? 0 }),
    typingLabel: typingLine((typingIds ?? []).map(nameOf), t),
    onlineCount,
  };
}

export function ConversationHeader({
  chat,
  showBack,
  onToggleInfo,
  infoOpen,
  members,
}: ConversationHeaderProps) {
  const { t, i18n } = useTranslation();
  const searching = useInChatSearch((state) => state.chatId === chat.id);

  const typingIds = useLiveStatus((state) => state.typing[chat.id]);
  const typing = (typingIds?.length ?? 0) > 0;
  const presence = useLiveStatus((state) =>
    chat.otherUserId ? state.presence[chat.otherUserId] : undefined,
  );
  usePresenceWatch(chat.otherUserId);
  const group = useGroupLine(chat, members, typingIds);
  const subtitle =
    group.subtitle ??
    (chat.kind === 'saved'
      ? t('chats.savedHint')
      : // The @username when there is nothing to say, or it is hidden. Hidden never looks different.
        statusLine({ typing: false, presence }, new Date(), i18n.language, t) ||
        (chat.username ? `@${chat.username}` : ''));

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
        <ChatAvatar chat={chat} online={presence?.online === true} className="size-10" />
        <span className="min-w-0">
          <span className="block truncate font-semibold">{chat.name}</span>
          {typing ? (
            <TypingIndicator className="flex text-xs" label={group.typingLabel} />
          ) : (
            <span
              className={cn(
                'block truncate text-xs',
                presence?.online ? 'text-accent-text' : 'text-text-muted',
              )}
            >
              {group.onlineCount > 0 ? (
                <span className="hidden text-accent-text md:inline">
                  {t('groups.online', { count: group.onlineCount })}
                  {' · '}
                </span>
              ) : null}
              {subtitle}
            </span>
          )}
        </span>
      </button>
      <div className="flex items-center">
        <DisappearingBadge timer={chat.disappearing} />
        {/* On phones the chat list, which also shows it, is hidden while a chat is open. */}
        {showBack ? <ConnectionStatus /> : null}
        <ComingSoonButton
          label={t('placeholder.callsTitle')}
          icon={Video}
          className="hidden sm:inline-flex"
        />
        <ComingSoonButton label={t('nav.calls')} icon={Phone} className="hidden sm:inline-flex" />
        <ScheduledButton chatId={chat.id} />
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('conversation.searchInChat')}
          aria-pressed={searching}
          onClick={() =>
            searching
              ? useInChatSearch.getState().close()
              : useInChatSearch.getState().open(chat.id)
          }
        >
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
