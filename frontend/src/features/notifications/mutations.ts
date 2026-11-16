import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { PushSettings, PushState } from '@zuvo/protocol';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { PUSH_KEY, pushApi } from './api';

/** Preview and sound: shown at once, undone if the server refuses. The same on all my devices. */
export function useSavePushSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const write = (settings: PushSettings) =>
    queryClient.setQueryData<PushState>(PUSH_KEY, (state) =>
      state ? { ...state, settings } : state,
    );
  return useMutation({
    mutationFn: (changes: Partial<PushSettings>) => pushApi.saveSettings(changes),
    onMutate: (changes) => {
      const before = queryClient.getQueryData<PushState>(PUSH_KEY)?.settings;
      if (before) write({ ...before, ...changes });
      return { before };
    },
    onSuccess: (saved) => {
      if (saved?.settings) write(saved.settings);
    },
    onError: (_error, _changes, context) => {
      if (context?.before) write(context.before);
      toast.error(t('notifications.settings.saveFailed'));
    },
  });
}

/** "Send test notification": says so when no device got it. */
export function useSendTestPush() {
  const { t } = useTranslation();
  return useMutation({
    mutationFn: () => pushApi.test(),
    onSuccess: ({ sent }) => {
      if (sent > 0) toast.success(t('notifications.settings.testSent', { count: sent }));
      else toast.warning(t('notifications.settings.testNone'));
    },
    onError: () => toast.error(t('notifications.settings.testFailed')),
  });
}

/** Stops notifications on another of my devices (it stays signed in). */
export function useRemovePushDevice() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => pushApi.removeDevice(id),
    onSuccess: (_result, id) => {
      queryClient.setQueryData<PushState>(PUSH_KEY, (state) =>
        state ? { ...state, devices: state.devices.filter((device) => device.id !== id) } : state,
      );
      toast.success(t('notifications.settings.removed'));
    },
    onError: () => toast.error(t('notifications.settings.removeFailed')),
  });
}
