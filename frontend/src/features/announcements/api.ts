import {
  type AnnouncementBanner,
  adminAnnouncementResponseSchema,
  adminAnnouncementsResponseSchema,
  announcementBannersResponseSchema,
  type CreateAnnouncementBody,
  okResponseSchema,
} from '@zuvo/protocol';
import { apiGet, apiPost, withQuery } from '@/lib/api-client';

export const announcementsApi = {
  mine: () => apiGet('/v1/announcements', announcementBannersResponseSchema),
  dismiss: (id: string) => apiPost(`/v1/announcements/${id}/dismiss`, {}, okResponseSchema),
  list: (cursor?: string) =>
    apiGet(
      withQuery('/v1/admin/announcements', { cursor, limit: 20 }),
      adminAnnouncementsResponseSchema,
    ),
  create: (body: CreateAnnouncementBody) =>
    apiPost('/v1/admin/announcements', body, adminAnnouncementResponseSchema),
  end: (id: string, reason: string) =>
    apiPost(`/v1/admin/announcements/${id}/end`, { reason }, adminAnnouncementResponseSchema),
};

export const bannersKey = ['announcements', 'mine'] as const;
export type { AnnouncementBanner };
