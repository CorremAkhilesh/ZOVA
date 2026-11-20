import type { MediaKind, StorageUsage } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { chatModels } from '../chats/chats.service.ts';
import { AppError } from '../lib/errors.ts';
import { loadUser, type UserDoc } from '../users/user-record.ts';

const MB = 1024 * 1024;

/** This person's limit in bytes: their own, set by an admin, or the default. */
export const quotaBytesOf = (app: FastifyInstance, user: Pick<UserDoc, 'storageQuotaMb'> | null) =>
  (user?.storageQuotaMb ?? app.env.MEDIA_USER_QUOTA_MB) * MB;

const EMPTY: StorageUsage['byKind'] = { image: 0, video: 0, audio: 0, voice: 0, document: 0 };

/**
 * What one person stores: finished files by kind, and uploads on their way (counted at their
 * declared size, so several started at once cannot slip past the limit together). Failed uploads
 * hold nothing. Index: ownerId + status + size; the kind is read from each document.
 */
export async function storageUsage(app: FastifyInstance, userId: string) {
  const rows = await chatModels(app).Media.aggregate<{
    _id: { status: 'pending' | 'ready'; kind: MediaKind };
    bytes: number;
  }>([
    { $match: { ownerId: new Types.ObjectId(userId), status: { $in: ['pending', 'ready'] } } },
    { $group: { _id: { status: '$status', kind: '$kind' }, bytes: { $sum: '$size' } } },
  ]);
  const byKind = { ...EMPTY };
  let pendingBytes = 0;
  for (const row of rows) {
    if (row._id.status === 'pending') pendingBytes += row.bytes;
    else if (row._id.kind in byKind) byKind[row._id.kind] += row.bytes;
  }
  const usedBytes = Object.values(byKind).reduce((sum, bytes) => sum + bytes, 0);
  return { usedBytes, pendingBytes, byKind };
}

/** GET /v1/me/storage */
export async function myStorage(app: FastifyInstance, userId: string): Promise<StorageUsage> {
  const [usage, user] = await Promise.all([storageUsage(app, userId), loadUser(app, userId)]);
  return { ...usage, quotaBytes: quotaBytesOf(app, user) };
}

/** Refuses a new upload that would take this person past their limit. */
export async function assertWithinQuota(
  app: FastifyInstance,
  userId: string,
  incoming: number,
): Promise<void> {
  const [usage, user] = await Promise.all([storageUsage(app, userId), loadUser(app, userId)]);
  const usedBytes = usage.usedBytes + usage.pendingBytes;
  const quotaBytes = quotaBytesOf(app, user);
  if (usedBytes + incoming > quotaBytes) {
    throw new AppError('STORAGE_QUOTA_EXCEEDED', 'Your storage is full.', {
      usedBytes,
      quotaBytes,
    });
  }
}
