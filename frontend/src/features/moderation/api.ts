import {
  blockedContactsResponseSchema,
  blockResponseSchema,
  type CreateReportBody,
  createReportResponseSchema,
  reportDetailResponseSchema,
  reportListResponseSchema,
  reportSummarySchema,
} from '@zuvo/protocol';
import { z } from 'zod';
import { apiDelete, apiGet, apiPost, apiPut, withQuery } from '@/lib/api-client';

export const moderationApi = {
  blocked: () => apiGet('/v1/me/blocks', blockedContactsResponseSchema),
  block: (userId: string) => apiPut(`/v1/me/blocks/${userId}`, {}, blockResponseSchema),
  unblock: (userId: string) => apiDelete(`/v1/me/blocks/${userId}`, blockResponseSchema),
  report: (body: CreateReportBody) => apiPost('/v1/reports', body, createReportResponseSchema),
};

export const adminReportsApi = {
  list: (status: 'open' | 'resolved' | undefined, cursor: string | undefined) =>
    apiGet(withQuery('/v1/admin/reports', { status, cursor, limit: 30 }), reportListResponseSchema),
  get: (id: string) => apiGet(`/v1/admin/reports/${id}`, reportDetailResponseSchema),
  resolve: (id: string, action: 'none' | 'deactivate', note: string) =>
    apiPost(
      `/v1/admin/reports/${id}/resolve`,
      { action, ...(note.trim() ? { note: note.trim() } : {}) },
      z.object({ report: reportSummarySchema }),
    ),
};
