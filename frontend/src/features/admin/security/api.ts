import {
  type AuditFilter,
  adminSecurityResponseSchema,
  adminUnlockResponseSchema,
  auditLogResponseSchema,
} from '@zuvo/protocol';
import { ApiClientError, apiGet, apiPost, withQuery } from '@/lib/api-client';

const filterParams = (filter: AuditFilter) => ({
  action: filter.action,
  actor: filter.actor,
  target: filter.target,
  from: filter.from,
  to: filter.to,
});

export const adminSecurityApi = {
  overview: () => apiGet('/v1/admin/security', adminSecurityResponseSchema),
  unlock: (id: string, reason: string) =>
    apiPost(`/v1/admin/security/locks/${id}/unlock`, { reason }, adminUnlockResponseSchema),
  audit: (filter: AuditFilter, cursor?: string) =>
    apiGet(
      withQuery('/v1/admin/audit-log', { ...filterParams(filter), cursor, limit: 50 }),
      auditLogResponseSchema,
    ),
};

/** Saves the filtered audit log as CSV through the browser's own download. */
export async function downloadAuditCsv(filter: AuditFilter): Promise<void> {
  let response: Response;
  try {
    response = await fetch(withQuery('/v1/admin/audit-log/export', filterParams(filter)), {
      credentials: 'include',
      redirect: 'manual',
    });
  } catch {
    throw new ApiClientError(0, 'Cannot reach the server. Check your connection.');
  }
  if (!response.ok) throw new ApiClientError(response.status, `Export failed (${response.status})`);
  const name =
    /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ??
    'audit-log.csv';
  const url = URL.createObjectURL(await response.blob());
  const link = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
