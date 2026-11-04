import {
  adminUserResponseSchema,
  adminUserStatusResponseSchema,
  adminUsersResponseSchema,
  auditLogResponseSchema,
  deviceSessionsResponseSchema,
  notMeResponseSchema,
  revokedSessionsResponseSchema,
} from '@zuvo/protocol';
import { apiDelete, apiGet, apiPost, apiPut, withQuery } from '@/lib/api-client';

export const securityApi = {
  sessions: () => apiGet('/v1/me/sessions', deviceSessionsResponseSchema),
  revoke: (id: string) => apiDelete(`/v1/me/sessions/${id}`, revokedSessionsResponseSchema),
  revokeOthers: () => apiPost('/v1/me/sessions/revoke-others', {}, revokedSessionsResponseSchema),
  notMe: (token: string) => apiPost('/v1/auth/not-me', { token }, notMeResponseSchema),
};

export const adminApi = {
  users: (q: string, cursor?: string) =>
    apiGet(withQuery('/v1/admin/users', { q, cursor, limit: 25 }), adminUsersResponseSchema),
  setStatus: (id: string, action: 'deactivate' | 'reactivate') =>
    apiPost(`/v1/admin/users/${id}/${action}`, {}, adminUserStatusResponseSchema),
  setRole: (id: string, role: 'admin' | 'user') =>
    apiPut(`/v1/admin/users/${id}/role`, { role }, adminUserResponseSchema),
  auditLog: (cursor?: string) =>
    apiGet(withQuery('/v1/admin/audit-log', { cursor, limit: 50 }), auditLogResponseSchema),
};
