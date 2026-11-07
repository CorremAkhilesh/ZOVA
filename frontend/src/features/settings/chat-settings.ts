import { type QueryClient, queryOptions } from '@tanstack/react-query';
import { type ChatSettings, chatSettingsResponseSchema } from '@zuvo/protocol';
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
  if (change.kind === 'settings') {
    queryClient.setQueryData(chatSettingsQuery.queryKey, change.settings);
    return;
  }
  if (change.kind === 'reconnected') {
    // Whatever changed while this device was away.
    void queryClient.invalidateQueries({ queryKey: chatSettingsQuery.queryKey });
  }
  void queryClient.invalidateQueries({ queryKey: ['me', 'blocks'] });
}
