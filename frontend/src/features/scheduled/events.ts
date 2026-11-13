import type { QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AccountChange } from '@/features/sync/account-events';
import { i18n } from '@/lib/i18n';
import { SCHEDULED_KEY } from './api';

/**
 * `scheduled:updated` from the server: fetch my scheduled messages again, and say so when one could
 * not be sent. True when that was the change; a reconnect refetches too but lets the rest run.
 */
export function applyScheduledChange(queryClient: QueryClient, change: AccountChange): boolean {
  if (change.kind === 'scheduled') {
    void queryClient.invalidateQueries({ queryKey: SCHEDULED_KEY });
    if (change.failed) {
      toast.error(i18n.t('scheduled.failedToast'), {
        id: `scheduled-failed-${change.failed.id}`,
        description: i18n.t(`scheduled.failure.${change.failed.reason}`),
      });
    }
    return true;
  }
  if (change.kind === 'reconnected')
    void queryClient.invalidateQueries({ queryKey: SCHEDULED_KEY });
  return false;
}
