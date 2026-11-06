import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { GroupMember, PublicProfile } from '@zuvo/protocol';
import { useEffect, useMemo } from 'react';
import { useLocalDb } from '@/features/chats/queries';
import type { ChatRow } from '@/features/sync/local-db';
import { useLive } from '@/features/sync/use-live';
import { groupsApi } from './api';

export const membersKey = (chatId: string) => ['group-members', chatId];

/**
 * The members of a group I am in. Kept in the local database too, so names still show offline, and
 * after leaving. A system message means they may have changed, so it asks again.
 */
export function useGroupMembers(chat: ChatRow): GroupMember[] | undefined {
  const db = useLocalDb();
  const queryClient = useQueryClient();
  const active = chat.group?.active === true;
  const { data } = useQuery({
    queryKey: membersKey(chat.id),
    queryFn: async () => {
      const members = await groupsApi.members(chat.id);
      await db?.profiles.bulkPut(members.map((member) => member.user)).catch(() => undefined);
      return members;
    },
    enabled: active,
  });
  const changeAt = chat.lastMessage?.system ? chat.lastMessage.seq : null;
  useEffect(() => {
    if (changeAt !== null) void queryClient.invalidateQueries({ queryKey: membersKey(chat.id) });
  }, [changeAt, chat.id, queryClient]);
  return active ? data : undefined;
}

/** Everyone this device knows about: sender names and photos, without asking the server each time. */
export function useKnownPeople(): Map<string, PublicProfile> {
  const db = useLocalDb();
  const people = useLive(() => db?.profiles.toArray() ?? [], [db]);
  return useMemo(() => new Map((people ?? []).map((person) => [person.id, person])), [people]);
}
