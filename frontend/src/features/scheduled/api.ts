import { queryOptions, useQuery } from '@tanstack/react-query';
import {
  type CreateScheduledBody,
  okResponseSchema,
  type ScheduledMessage,
  scheduledListResponseSchema,
  scheduledResponseSchema,
} from '@zuvo/protocol';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api-client';

const itemPath = (id: string) => `/v1/me/scheduled/${encodeURIComponent(id)}`;

export const scheduledApi = {
  list: () => apiGet('/v1/me/scheduled', scheduledListResponseSchema),
  create: (body: CreateScheduledBody) => apiPost('/v1/me/scheduled', body, scheduledResponseSchema),
  update: (id: string, changes: { text?: string; sendAt?: string }) =>
    apiPatch(itemPath(id), changes, scheduledResponseSchema),
  sendNow: (id: string) => apiPost(`${itemPath(id)}/send-now`, undefined, scheduledResponseSchema),
  remove: (id: string) => apiDelete(itemPath(id), okResponseSchema),
};

export const SCHEDULED_KEY = ['me', 'scheduled'] as const;

/**
 * All of mine, waiting or failed, soonest first: one request serves every chat's header. Changes on
 * any device arrive as `scheduled:updated`, which refetches it.
 */
export const scheduledQuery = queryOptions({
  queryKey: SCHEDULED_KEY,
  queryFn: async (): Promise<ScheduledMessage[]> => (await scheduledApi.list()).items,
  staleTime: 60_000,
});

/** This chat's scheduled messages, still to go or failed. */
export function useChatScheduled(chatId: string) {
  return useQuery({
    ...scheduledQuery,
    select: (items) => items.filter((item) => item.chatId === chatId && item.status !== 'sent'),
  });
}
