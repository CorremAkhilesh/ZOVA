import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { PUSH_KEY, usePushState } from './api';
import { usePushPrefs } from './prefs';
import { subscribeThisDevice, unsubscribeThisDevice } from './subscription';
import {
  type PermissionState,
  type PushSupport,
  permissionChanged,
  pushSupport,
  readPermission,
  usePermission,
} from './support';

/**
 * Push on this device, as the screens explain it:
 * - server-off: the server has no VAPID key (nothing to offer)
 * - ios-install / unsupported: this browser cannot, or only once installed
 * - denied: blocked in the browser's settings
 * - ask: the browser has not been asked yet
 * - on / off: allowed, and turned on or off here
 */
export type PushStatus =
  | 'server-off'
  | 'ios-install'
  | 'unsupported'
  | 'denied'
  | 'ask'
  | 'on'
  | 'off';

/** Statuses where push cannot work until the person does something (or ever, here). */
export type PushProblem = Extract<PushStatus, 'denied' | 'ios-install' | 'unsupported'>;
const PROBLEMS: readonly PushStatus[] = ['denied', 'ios-install', 'unsupported'];
export const isPushProblem = (status: PushStatus): status is PushProblem =>
  PROBLEMS.includes(status);

export function pushStatus(input: {
  publicKey: string | null | undefined;
  support: PushSupport;
  permission: PermissionState;
  enabled: boolean;
}): PushStatus {
  if (!input.publicKey) return 'server-off';
  if (input.support === 'ios-install') return 'ios-install';
  if (input.support === 'unsupported' || input.permission === 'unsupported') return 'unsupported';
  if (input.permission === 'denied') return 'denied';
  if (input.permission === 'default') return 'ask';
  return input.enabled ? 'on' : 'off';
}

/** This device's push status; undefined while the server's answer is loading. */
export function usePushStatus(): PushStatus | undefined {
  const { data } = usePushState();
  const enabled = usePushPrefs((state) => state.enabled);
  const permission = usePermission();
  if (!data) return undefined;
  return pushStatus({ publicKey: data.publicKey, support: pushSupport(), permission, enabled });
}

export type TurnOnResult = 'on' | 'denied' | 'default' | 'failed';

/** Asks the browser (only ever after a click), then subscribes this device. */
export async function turnOnPush(publicKey: string): Promise<TurnOnResult> {
  usePushPrefs.getState().setEnabled(true);
  const permission =
    readPermission() === 'granted' ? 'granted' : await Notification.requestPermission();
  permissionChanged();
  if (permission !== 'granted') return permission;
  try {
    await subscribeThisDevice(publicKey);
    return 'on';
  } catch (error) {
    console.warn('[push] could not subscribe', error);
    return 'failed';
  }
}

export async function turnOffPush(): Promise<void> {
  usePushPrefs.getState().setEnabled(false);
  await unsubscribeThisDevice({ tellServer: true });
}

/** On / off for this device, refreshing the device list afterwards. */
export function usePushToggle() {
  const queryClient = useQueryClient();
  return useCallback(
    async (on: boolean, publicKey: string): Promise<TurnOnResult | 'off'> => {
      let result: TurnOnResult | 'off' = 'off';
      if (on) result = await turnOnPush(publicKey);
      else await turnOffPush();
      void queryClient.invalidateQueries({ queryKey: PUSH_KEY });
      return result;
    },
    [queryClient],
  );
}
