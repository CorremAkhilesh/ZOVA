import type { QueryClient } from '@tanstack/react-query';
import { QUIET_HOURS_KEY } from '@/features/quiet-hours/api';
import type { AccountChange } from '@/features/sync/account-events';
import { APPEARANCE_KEY, WALLPAPER_IMAGES_KEY } from './api';

/**
 * Appearance and quiet hours from my other devices. True when the change was one of these (nothing
 * else to do); a reconnect refetches them and returns false, so the caller refreshes the rest too.
 */
export function applyPersonalChange(queryClient: QueryClient, change: AccountChange): boolean {
  if (change.kind === 'appearance') {
    queryClient.setQueryData(APPEARANCE_KEY, change.appearance);
    // A picture deleted on another device may have been the reason.
    void queryClient.invalidateQueries({ queryKey: WALLPAPER_IMAGES_KEY });
    return true;
  }
  if (change.kind === 'quietHours') {
    queryClient.setQueryData(QUIET_HOURS_KEY, change.quietHours);
    return true;
  }
  if (change.kind === 'reconnected') {
    void queryClient.invalidateQueries({ queryKey: APPEARANCE_KEY });
    void queryClient.invalidateQueries({ queryKey: QUIET_HOURS_KEY });
  }
  return false;
}
