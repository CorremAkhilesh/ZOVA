import { queryOptions, useQuery } from '@tanstack/react-query';
import {
  type AppLockIdle,
  biometricOptionsResponseSchema,
  type LockStatus,
  lockStatusResponseSchema,
  lockStatusSchema,
  resetPinRequestResponseSchema,
} from '@zuvo/protocol';
import { z } from 'zod';
import { apiGet, apiPatch, apiPost, apiPut, apiRequest } from '@/lib/api-client';

/** Changes answer with the new status, or just `{ ok: true }`: either way the status is refetched. */
const changed = z.object({ lock: lockStatusSchema.optional() });
const anything = z.object({});
type WebAuthnJson = Record<string, unknown>;

export const lockApi = {
  status: () => apiGet('/v1/me/lock', lockStatusResponseSchema),
  setPin: (pin: string, currentPin?: string) =>
    apiPut('/v1/me/lock/pin', currentPin ? { pin, currentPin } : { pin }, changed),
  removePin: (pin: string) =>
    apiRequest('/v1/me/lock/pin', changed, {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin }),
    }),
  verify: (pin: string) => apiPost('/v1/me/lock/verify', { pin }, changed),
  settings: (appLock: { enabled: boolean; idleMinutes: AppLockIdle }) =>
    apiPatch('/v1/me/lock/settings', { appLock }, changed),
  lockChat: (chatId: string, locked: boolean) =>
    apiPut(`/v1/chats/${encodeURIComponent(chatId)}/lock`, { locked }, anything),
  requestReset: () =>
    apiPost('/v1/me/lock/reset/request', undefined, resetPinRequestResponseSchema),
  verifyReset: (code: string) => apiPost('/v1/me/lock/reset/verify', { code }, changed),
  biometricOptions: (purpose: 'register' | 'unlock') =>
    apiPost(`/v1/me/lock/biometric/${purpose}/options`, undefined, biometricOptionsResponseSchema),
  biometricVerify: (purpose: 'register' | 'unlock', response: WebAuthnJson) =>
    apiPost(`/v1/me/lock/biometric/${purpose}/verify`, { response }, changed),
  removeBiometric: () => apiRequest('/v1/me/lock/biometric', changed, { method: 'DELETE' }),
};

export const LOCK_KEY = ['me', 'lock'] as const;

/** My PIN, app lock and unlock methods. `lock:updated` and a reconnect refetch it. */
export const lockQuery = queryOptions({
  queryKey: LOCK_KEY,
  queryFn: async (): Promise<LockStatus> => (await lockApi.status()).lock,
  staleTime: 60_000,
});

export const useLockStatus = () => useQuery(lockQuery);
