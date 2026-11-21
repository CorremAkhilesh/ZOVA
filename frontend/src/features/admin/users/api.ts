import {
  type AdminBulkBody,
  adminBulkResponseSchema,
  adminSignOutResponseSchema,
  adminStorageQuotaResponseSchema,
  adminSuspendResponseSchema,
  adminUserDetailSchema,
  type adminUserFilterSchema,
  adminUserResponseSchema,
  type adminUserSortSchema,
  adminUserStatusResponseSchema,
  adminUsersResponseSchema,
} from '@zuvo/protocol';
import type { z } from 'zod';
import { ApiClientError, apiGet, apiPost, apiPut, withQuery } from '@/lib/api-client';

export type UserFilter = z.infer<typeof adminUserFilterSchema>;
export type UserSort = z.infer<typeof adminUserSortSchema>;
export interface ListParams {
  q: string;
  filter: UserFilter;
  sort: UserSort;
}

export const PAGE_SIZE = 25;

export const adminUsersApi = {
  list: ({ q, filter, sort }: ListParams, cursor?: string) =>
    apiGet(
      withQuery('/v1/admin/users', { q, filter, sort, cursor, limit: PAGE_SIZE }),
      adminUsersResponseSchema,
    ),
  detail: (id: string) => apiGet(`/v1/admin/users/${id}`, adminUserDetailSchema),
  setStatus: (id: string, action: 'deactivate' | 'reactivate', reason: string) =>
    apiPost(`/v1/admin/users/${id}/${action}`, { reason }, adminUserStatusResponseSchema),
  setRole: (id: string, role: 'admin' | 'user', reason: string) =>
    apiPut(`/v1/admin/users/${id}/role`, { role, reason }, adminUserResponseSchema),
  /** `null`: back to the default limit. */
  setQuota: (id: string, quotaMb: number | null, reason: string) =>
    apiPut(
      `/v1/admin/users/${id}/storage-quota`,
      { quotaMb, reason },
      adminStorageQuotaResponseSchema,
    ),
  signOut: (id: string, reason: string) =>
    apiPost(`/v1/admin/users/${id}/sign-out`, { reason }, adminSignOutResponseSchema),
  suspend: (id: string, until: string, reason: string) =>
    apiPost(`/v1/admin/users/${id}/suspend`, { until, reason }, adminSuspendResponseSchema),
  unsuspend: (id: string, reason: string) =>
    apiPost(`/v1/admin/users/${id}/unsuspend`, { reason }, adminSuspendResponseSchema),
  bulk: (body: AdminBulkBody) => apiPost('/v1/admin/users/bulk', body, adminBulkResponseSchema),
};

export const usersKey = (params: ListParams) => ['admin', 'users', params] as const;
export const userKey = (id: string) => ['admin', 'user', id] as const;

/** Saves the filtered list as CSV through the browser's own download. */
export async function downloadUsersCsv(params: ListParams): Promise<void> {
  let response: Response;
  try {
    response = await fetch(withQuery('/v1/admin/users/export', { ...params }), {
      credentials: 'include',
      redirect: 'manual',
    });
  } catch {
    throw new ApiClientError(0, 'Cannot reach the server. Check your connection.');
  }
  if (!response.ok) throw new ApiClientError(response.status, `Export failed (${response.status})`);
  const name =
    /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ??
    'people.csv';
  const url = URL.createObjectURL(await response.blob());
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
