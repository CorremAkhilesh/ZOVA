import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BlockedContact, PublicProfile } from '@zuvo/protocol';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { authErrorMessage } from '@/features/auth/errors';
import { moderationApi } from './api';

/** Everyone I blocked. Other devices' changes arrive as `blocks:changed`, which refetches this. */
export const blocksQuery = queryOptions({
  queryKey: ['me', 'blocks'],
  queryFn: async () => (await moderationApi.blocked()).items,
  staleTime: 60_000,
});

/** Whether I blocked this person. Undefined while unknown. */
export function useIsBlocked(userId: string | undefined): boolean | undefined {
  const { data } = useQuery({ ...blocksQuery, enabled: Boolean(userId) });
  if (!userId || !data) return undefined;
  return data.some((item) => item.user.id === userId);
}

/** Block or unblock, shown at once and rolled back if the server refuses. */
export function useBlockToggle() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ user, block }: { user: PublicProfile; block: boolean }) =>
      block ? moderationApi.block(user.id) : moderationApi.unblock(user.id),
    onMutate: async ({ user, block }) => {
      await queryClient.cancelQueries({ queryKey: blocksQuery.queryKey });
      const previous = queryClient.getQueryData(blocksQuery.queryKey);
      const rest = (previous ?? []).filter((item) => item.user.id !== user.id);
      const next: BlockedContact[] = block
        ? [{ user, blockedAt: new Date().toISOString() }, ...rest]
        : rest;
      queryClient.setQueryData(blocksQuery.queryKey, next);
      return { previous };
    },
    onSuccess: (_result, { user, block }) => {
      toast.success(
        t(block ? 'blocks.blockedToast' : 'blocks.unblockedToast', { name: user.displayName }),
      );
    },
    onError: (error, _variables, context) => {
      queryClient.setQueryData(blocksQuery.queryKey, context?.previous);
      toast.error(authErrorMessage(error, t));
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: blocksQuery.queryKey }),
  });
}
