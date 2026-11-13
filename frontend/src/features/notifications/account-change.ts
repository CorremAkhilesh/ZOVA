import type { QueryClient } from '@tanstack/react-query';
import type { PushState } from '@zuvo/protocol';
import type { AccountChange } from '@/features/sync/account-events';
import { PUSH_KEY } from './api';

/**
 * `push:updated` from my other devices: the new settings at once, and the device list again (a
 * device may have been added or removed). True when that was the change; a reconnect refetches too
 * but lets the rest run.
 */
export function applyPushChange(queryClient: QueryClient, change: AccountChange): boolean {
  if (change.kind === 'push') {
    queryClient.setQueryData<PushState>(PUSH_KEY, (state) =>
      state ? { ...state, settings: change.settings } : state,
    );
    void queryClient.invalidateQueries({ queryKey: PUSH_KEY });
    return true;
  }
  if (change.kind === 'reconnected') void queryClient.invalidateQueries({ queryKey: PUSH_KEY });
  return false;
}
