import { useQuery } from '@tanstack/react-query';
import type { Mention } from '@zuvo/protocol';
import { lazy, Suspense, useMemo } from 'react';
import { create } from 'zustand';
import type { MentionMark } from '@/features/formatting/FormattedText';
import { groupsApi } from '@/features/groups/api';
import { membersKey } from '@/features/groups/queries';
import { mentionSpans } from './mentions';

/**
 * The mentions of a bubble: buttons for people still in the group, plain text for anyone who left.
 * Reads the member list the chat screen already loaded; never asks the server by itself.
 */
export function useMentionMarks(
  chatId: string,
  text: string,
  mentions: Mention[] | undefined,
): MentionMark[] | undefined {
  const { data } = useQuery({
    queryKey: membersKey(chatId),
    queryFn: () => groupsApi.members(chatId),
    enabled: false,
  });
  return useMemo(() => {
    if (!mentions?.length) return undefined;
    const members = new Set((data ?? []).map((member) => member.user.id));
    return mentionSpans(text, mentions, (userId) => members.has(userId));
  }, [data, mentions, text]);
}

/** Whose profile a tapped mention opened. */
export const useMentionProfile = create<{
  userId: string | null;
  open: (userId: string) => void;
  close: () => void;
}>()((set) => ({
  userId: null,
  open: (userId) => set({ userId }),
  close: () => set({ userId: null }),
}));

export const openMentionProfile = (userId: string) => useMentionProfile.getState().open(userId);

const MentionProfileDialog = lazy(() => import('./MentionProfileDialog'));

/** Mounted once in the app shell; its code loads the first time a mention is tapped. */
export function MentionProfileHost() {
  const userId = useMentionProfile((state) => state.userId);
  if (!userId) return null;
  return (
    <Suspense fallback={null}>
      <MentionProfileDialog userId={userId} />
    </Suspense>
  );
}
