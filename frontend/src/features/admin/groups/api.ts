import {
  adminDeleteGroupResponseSchema,
  adminGroupResponseSchema,
  adminGroupsResponseSchema,
} from '@zuvo/protocol';
import { apiGet, apiPost, withQuery } from '@/lib/api-client';

export type GroupFilter = 'all' | 'archived';

export const adminGroupsApi = {
  list: (q: string, filter: GroupFilter, cursor?: string) =>
    apiGet(
      withQuery('/v1/admin/groups', { q, filter, cursor, limit: 25 }),
      adminGroupsResponseSchema,
    ),
  archive: (id: string, reason: string) =>
    apiPost(`/v1/admin/groups/${id}/archive`, { reason }, adminGroupResponseSchema),
  restore: (id: string, reason: string) =>
    apiPost(`/v1/admin/groups/${id}/restore`, { reason }, adminGroupResponseSchema),
  remove: (id: string, confirmName: string, reason: string) =>
    apiPost(
      `/v1/admin/groups/${id}/delete`,
      { confirmName, reason },
      adminDeleteGroupResponseSchema,
    ),
};
