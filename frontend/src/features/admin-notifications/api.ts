import { adminPushResponseSchema, remindResponseSchema } from '@zuvo/protocol';
import { apiGet, apiPost, withQuery } from '@/lib/api-client';

/** Admin → Notifications. */
export const adminPushApi = {
  page: (cursor?: string) =>
    apiGet(withQuery('/v1/admin/notifications', { cursor, limit: 100 }), adminPushResponseSchema),
  remind: (userIds: string[]) =>
    apiPost('/v1/admin/notifications/remind', { userIds }, remindResponseSchema),
};

export const ADMIN_PUSH_KEY = ['admin', 'notifications'] as const;
