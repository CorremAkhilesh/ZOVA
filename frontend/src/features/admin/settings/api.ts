import { type AdminSettingsBody, adminSettingsResponseSchema } from '@zuvo/protocol';
import { apiGet, apiPut } from '@/lib/api-client';

export const adminSettingsApi = {
  get: () => apiGet('/v1/admin/settings', adminSettingsResponseSchema),
  save: (body: AdminSettingsBody) =>
    apiPut('/v1/admin/settings', body, adminSettingsResponseSchema),
};

export const adminSettingsKey = ['admin', 'settings'] as const;
