import { useQueryClient } from '@tanstack/react-query';
import type { PushState } from '@zuvo/protocol';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { saveLanguageForWorker } from '@/sw/push/language';
import { PUSH_KEY, usePushState } from './api';
import { usePushPrefs } from './prefs';
import { subscribeThisDevice } from './subscription';
import { pushSupport, usePermission } from './support';

/**
 * Signed in (this hook runs in the app shell), the browser allows notifications, push is on for
 * this device and the server has a key: subscribe, and tell the server again on every start so it
 * always has this browser's current endpoint. Never asks for permission by itself.
 */
export function usePushLifecycle(): void {
  const queryClient = useQueryClient();
  const publicKey = usePushState().data?.publicKey ?? null;
  const enabled = usePushPrefs((state) => state.enabled);
  const permission = usePermission();
  const { i18n } = useTranslation();

  useEffect(() => {
    if (!publicKey || !enabled || permission !== 'granted' || pushSupport() !== 'supported') return;
    let cancelled = false;
    subscribeThisDevice(publicKey)
      .then((device) => {
        if (cancelled) return;
        queryClient.setQueryData<PushState>(PUSH_KEY, (state) =>
          state
            ? {
                ...state,
                devices: [device, ...state.devices.filter((d) => d.id !== device.id && !d.current)],
              }
            : state,
        );
      })
      .catch((error: unknown) => console.warn('[push] could not subscribe', error));
    return () => {
      cancelled = true;
    };
  }, [enabled, permission, publicKey, queryClient]);

  // The service worker words its notification buttons in the app's language.
  useEffect(() => {
    void saveLanguageForWorker(i18n.language);
  }, [i18n.language]);
}
