import { queryOptions, useQuery } from '@tanstack/react-query';
import {
  type PushSettings,
  type PushState,
  pushSettingsSchema,
  pushStateResponseSchema,
  pushSubscribeResponseSchema,
  pushTestResponseSchema,
} from '@zuvo/protocol';
import { z } from 'zod';
import { apiGet, apiPost, apiPut, apiRequest } from '@/lib/api-client';

/** Answers with no body, or one this screen does not need. */
const noContent = z.unknown();
/** PUT settings: the saved settings when the server sends them. */
const settingsSaved = z.looseObject({ settings: pushSettingsSchema.optional() }).optional();

const jsonDelete = (path: string, body: unknown) =>
  apiRequest(path, noContent, {
    method: 'DELETE',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

export const pushApi = {
  get: () => apiGet('/v1/me/push', pushStateResponseSchema),
  subscribe: (subscription: PushSubscriptionJSON) =>
    apiPut('/v1/me/push/subscription', subscription, pushSubscribeResponseSchema),
  unsubscribe: (endpoint: string) => jsonDelete('/v1/me/push/subscription', { endpoint }),
  removeDevice: (id: string) =>
    apiRequest(`/v1/me/push/devices/${encodeURIComponent(id)}`, noContent, { method: 'DELETE' }),
  saveSettings: (changes: Partial<PushSettings>) =>
    apiPut('/v1/me/push/settings', changes, settingsSaved),
  test: () => apiPost('/v1/me/push/test', undefined, pushTestResponseSchema),
};

export const PUSH_KEY = ['me', 'push'] as const;

/** VAPID key, my notification settings and my devices with push. `push:updated` refreshes it. */
export const pushQuery = queryOptions({
  queryKey: PUSH_KEY,
  queryFn: (): Promise<PushState> => pushApi.get(),
  staleTime: 5 * 60_000,
});

export const usePushState = () => useQuery(pushQuery);
