import { queryOptions, useQuery } from '@tanstack/react-query';
import { type QuietHours, quietHoursResponseSchema } from '@zuvo/protocol';
import { apiGet, apiPut } from '@/lib/api-client';

export const quietHoursApi = {
  get: () => apiGet('/v1/me/quiet-hours', quietHoursResponseSchema),
  save: (quietHours: QuietHours) =>
    apiPut('/v1/me/quiet-hours', quietHours, quietHoursResponseSchema),
};

export const QUIET_HOURS_KEY = ['me', 'quiet-hours'] as const;

/** `quiet-hours:updated` writes straight into it; a reconnect refetches it. */
export const quietHoursQuery = queryOptions({
  queryKey: QUIET_HOURS_KEY,
  queryFn: async (): Promise<QuietHours> => (await quietHoursApi.get()).quietHours,
  staleTime: 5 * 60_000,
});

export const useQuietHoursSettings = () => useQuery(quietHoursQuery);
