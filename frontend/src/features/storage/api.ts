import {
  adminStorageQuotaResponseSchema,
  STORAGE_WARN_RATIO,
  type StorageUsage,
  storageUsageSchema,
} from '@zuvo/protocol';
import { apiGet, apiPut } from '@/lib/api-client';

export const storageApi = {
  mine: () => apiGet('/v1/me/storage', storageUsageSchema),
  /** Admin only. `null` puts the default limit back. */
  setQuota: (userId: string, quotaMb: number | null) =>
    apiPut(`/v1/admin/users/${userId}/storage-quota`, { quotaMb }, adminStorageQuotaResponseSchema),
};

export const storageQueryKey = ['me', 'storage'] as const;

/** Uploads on their way count against the limit too, as on the server. */
export const takenBytes = (usage: StorageUsage) => usage.usedBytes + usage.pendingBytes;

export type StorageLevel = 'ok' | 'nearlyFull' | 'full';

export function storageLevel(usage: StorageUsage): StorageLevel {
  const share = takenBytes(usage) / usage.quotaBytes;
  if (share >= 1) return 'full';
  return share >= STORAGE_WARN_RATIO ? 'nearlyFull' : 'ok';
}

const listeners = new Set<() => void>();

/** Something that changes how much I store (an upload finished): whoever shows it refreshes. */
export function storageChanged(): void {
  for (const listener of listeners) listener();
}

export function onStorageChanged(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
