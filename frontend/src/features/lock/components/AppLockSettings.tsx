import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AppLockIdle, LockStatus } from '@zuvo/protocol';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { LOCK_KEY, lockApi } from '../api';
import { lockErrorMessage } from '../errors';
import { setAppLockFlag } from '../store';

const IDLE: readonly AppLockIdle[] = [1, 5, 15, 60];
type AppLock = LockStatus['appLock'];

function useSaveAppLock() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (appLock: AppLock) => lockApi.settings(appLock),
    onMutate: async (appLock) => {
      await queryClient.cancelQueries({ queryKey: LOCK_KEY });
      const previous = queryClient.getQueryData<LockStatus>(LOCK_KEY);
      if (previous) queryClient.setQueryData(LOCK_KEY, { ...previous, appLock });
      return { previous };
    },
    onSuccess: ({ lock }, appLock) => {
      if (lock) queryClient.setQueryData(LOCK_KEY, lock);
      setAppLockFlag(appLock.enabled);
    },
    onError: (error, _appLock, context) => {
      if (context?.previous) queryClient.setQueryData(LOCK_KEY, context.previous);
      toast.error(lockErrorMessage(error, t));
    },
  });
}

/** App lock on or off, and after how long without use it locks. Needs a PIN. */
export function AppLockSettings({ status }: { status: LockStatus }) {
  const { t } = useTranslation();
  const save = useSaveAppLock();
  const hintId = useId();
  const { appLock, pinSet } = status;
  return (
    <div className="space-y-4">
      <label className={cn('flex items-start gap-4', pinSet ? 'cursor-pointer' : 'opacity-60')}>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{t('lock.appLock')}</span>
          <span id={hintId} className="block text-sm text-text-muted">
            {t(pinSet ? 'lock.appLockHint' : 'lock.appLockNeedsPin')}
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          aria-checked={appLock.enabled}
          aria-describedby={hintId}
          checked={appLock.enabled}
          disabled={!pinSet}
          onChange={(event) => save.mutate({ ...appLock, enabled: event.target.checked })}
          className="peer sr-only"
        />
        <span
          aria-hidden
          className={cn(
            'relative mt-1 inline-flex h-6 w-11 shrink-0 rounded-full transition-colors',
            'peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-2',
            appLock.enabled ? 'bg-brand' : 'bg-border',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 size-5 rounded-full bg-white shadow transition-transform',
              appLock.enabled ? 'translate-x-5.5' : 'translate-x-0.5',
            )}
          />
        </span>
      </label>
      {pinSet && appLock.enabled ? (
        <div className="space-y-2">
          <p className="text-sm font-medium" id={`${hintId}-idle`}>
            {t('lock.idleLabel')}
          </p>
          <div
            role="radiogroup"
            aria-labelledby={`${hintId}-idle`}
            className="flex flex-wrap gap-2"
          >
            {IDLE.map((minutes) => (
              // biome-ignore lint/a11y/useSemanticElements: segmented control styled as buttons
              <button
                key={minutes}
                type="button"
                role="radio"
                aria-checked={appLock.idleMinutes === minutes}
                onClick={() => save.mutate({ ...appLock, idleMinutes: minutes })}
                className={cn(
                  'rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                  appLock.idleMinutes === minutes
                    ? 'border-brand bg-brand-subtle text-brand-text'
                    : 'text-text-muted hover:text-text',
                )}
              >
                {minutes === 60 ? t('lock.idleHour') : t('lock.idleMinutes', { count: minutes })}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
