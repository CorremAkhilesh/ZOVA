import {
  activeCallResponseSchema,
  callAccessResponseSchema,
  callLogResponseSchema,
  iceResponseSchema,
} from '@zuvo/protocol';
import { apiGet, withQuery } from '@/lib/api-client';

export const callsApi = {
  access: async () => (await apiGet('/v1/calls/access', callAccessResponseSchema)).enabled,
  ice: () => apiGet('/v1/calls/ice', iceResponseSchema),
  active: async () => (await apiGet('/v1/calls/active', activeCallResponseSchema)).call,
  history: (before?: string) =>
    apiGet(withQuery('/v1/calls', { before, limit: 50 }), callLogResponseSchema),
};
