import { type QueryClient, queryOptions } from '@tanstack/react-query';
import { type ChatSettings, chatSettingsResponseSchema } from '@zuvo/protocol';
import { applyPersonalChange } from '@/features/appearance/account-change';
import { FOLDERS_KEY } from '@/features/folders/api';
import { LOCK_KEY } from '@/features/lock/api';
import { applyScheduledChange } from '@/features/scheduled/events';
import type { AccountChange } from '@/features/sync/account-events';
import { apiGet, apiPatch } from '@/lib/api-client';

export const chatSettingsApi = {
  get: () => apiGet('/v1/me/chat-settings', chatSettingsResponseSchema),
  update: (changes: Partial<ChatSettings>) =>
    apiPatch('/v1/me/chat-settings', changes, chatSettingsResponseSchema),
};

export const chatSettingsQuery = queryOptions({
  queryKey: ['me', 'chat-settings'],
  queryFn: async () => (await chatSettingsApi.get()).settings,
});

/** Keeps this device in step with changes made on my other devices. */
export function applyAccountChange(queryClient: QueryClient, change: AccountChange) {
  if (applyPersonalChange(queryClient, change) || applyScheduledChange(queryClient, change)) return;
  if (change.kind === 'settings') {
    queryClient.setQueryData(chatSettingsQuery.queryKey, change.settings);
    return;
  }
  if (change.kind === 'folders') {
    void queryClient.invalidateQueries({ queryKey: FOLDERS_KEY });
    return;
  }
  if (change.kind === 'lock') {
    void queryClient.invalidateQueries({ queryKey: LOCK_KEY });
    return;
  }
  if (change.kind === 'reconnected') {
    // Whatever changed while this device was away.
    void queryClient.invalidateQueries({ queryKey: chatSettingsQuery.queryKey });
    void queryClient.invalidateQueries({ queryKey: FOLDERS_KEY });
    void queryClient.invalidateQueries({ queryKey: LOCK_KEY });
  }
  void queryClient.invalidateQueries({ queryKey: ['me', 'blocks'] });
}
