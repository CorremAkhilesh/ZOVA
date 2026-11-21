import { adminDashboardSchema } from '@zuvo/protocol';
import { apiGet } from '@/lib/api-client';

export const adminApi = {
  dashboard: () => apiGet('/v1/admin/dashboard', adminDashboardSchema),
};

export const adminDashboardKey = ['admin', 'dashboard'] as const;
