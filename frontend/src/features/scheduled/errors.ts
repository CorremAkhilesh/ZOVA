import { SCHEDULED_MAX } from '@zuvo/protocol';
import { ApiClientError } from '@/lib/api-client';
import { i18n } from '@/lib/i18n';

/** A refused schedule, edit, "Send now" or delete, in words. */
export function scheduleErrorText(error: unknown): string {
  if (error instanceof ApiClientError) {
    const code = error.apiError?.code;
    if (code === 'SCHEDULED_LIMIT_REACHED') {
      return i18n.t('scheduled.problems.limit', { max: SCHEDULED_MAX });
    }
    if (code === 'CONFLICT') return i18n.t('scheduled.problems.notWaiting');
    if (error.isNetworkError) return i18n.t('scheduled.problems.offline');
  }
  return i18n.t('scheduled.problems.failed');
}
