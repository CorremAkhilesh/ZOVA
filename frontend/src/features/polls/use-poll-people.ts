import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useSession } from '@/features/auth/session';
import { useChat } from '@/features/chats/queries';
import { useKnownPeople } from '@/features/groups/queries';

export interface PollPerson {
  id: string;
  name: string;
  avatar: string | undefined;
  me: boolean;
}

/**
 * Who a voter is, from what this device already knows: the group's members (kept locally), the
 * other person in a 1:1 chat, and me. The server never sends anyone I may not see (hidden admins).
 */
export function usePollPeople(chatId: string): (id: string) => PollPerson {
  const { t } = useTranslation();
  const session = useSession();
  const chat = useChat(chatId);
  const known = useKnownPeople();
  const you = t('chats.you');
  const unknown = t('chats.unknownPerson');
  return useCallback(
    (id: string) => {
      const me = id === session?.user.id;
      const profile = me
        ? session?.user
        : (known.get(id) ?? (chat?.otherUser?.id === id ? chat.otherUser : undefined));
      return {
        id,
        me,
        name: me ? you : (profile?.displayName ?? unknown),
        avatar: profile?.avatar?.small ?? undefined,
      };
    },
    [chat, known, session, unknown, you],
  );
}
