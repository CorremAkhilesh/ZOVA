import {
  deviceSessionsResponseSchema,
  notMeResponseSchema,
  renameSessionResponseSchema,
  revokedSessionsResponseSchema,
} from '@zuvo/protocol';
import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api-client';

export const securityApi = {
  sessions: () => apiGet('/v1/me/sessions', deviceSessionsResponseSchema),
  revoke: (id: string) => apiDelete(`/v1/me/sessions/${id}`, revokedSessionsResponseSchema),
  rename: (id: string, name: string | null) =>
    apiPatch(`/v1/me/sessions/${id}`, { name }, renameSessionResponseSchema),
  revokeOthers: () => apiPost('/v1/me/sessions/revoke-others', {}, revokedSessionsResponseSchema),
  notMe: (token: string) => apiPost('/v1/auth/not-me', { token }, notMeResponseSchema),
};
