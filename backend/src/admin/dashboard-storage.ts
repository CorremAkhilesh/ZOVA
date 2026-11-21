import type { AdminDashboard } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import type { Types } from 'mongoose';
import { chatModels } from '../chats/chats.service.ts';
import { quotaBytesOf } from '../media/quota.ts';
import { type UserDoc, usersModel } from '../users/user-record.ts';

export const TOP_STORAGE_USERS = 10;

/**
 * Finished files per person, most first. Index: status + ownerId + size (covered: no file document
 * is read, and nothing about a file but its size and owner is used).
 */
export function storagePerOwner(app: FastifyInstance) {
  return chatModels(app).Media.aggregate<{ _id: Types.ObjectId; bytes: number }>([
    { $match: { status: 'ready' } },
    { $group: { _id: '$ownerId', bytes: { $sum: '$size' } } },
    { $sort: { bytes: -1 } },
  ]);
}

async function diskOf(app: FastifyInstance): Promise<AdminDashboard['storage']['disk']> {
  try {
    const space = await app.storage.space();
    if (!space || space.total <= 0) return null;
    const usedBytes = space.total - space.free;
    return {
      totalBytes: space.total,
      usedBytes,
      percent: Math.round((usedBytes / space.total) * 1000) / 10,
      guardPercent: app.settings.current().storageGuardPercent,
    };
  } catch (error) {
    app.log.warn({ err: error }, 'admin dashboard: could not read disk space');
    return null;
  }
}

export async function storageStats(app: FastifyInstance): Promise<AdminDashboard['storage']> {
  const [disk, owners] = await Promise.all([diskOf(app), storagePerOwner(app)]);
  const filesBytes = owners.reduce((sum, row) => sum + row.bytes, 0);
  const top = owners.slice(0, TOP_STORAGE_USERS);
  const users = (await usersModel(app)
    .find({ _id: { $in: top.map((row) => row._id) } })
    .select({ email: 1, displayName: 1, username: 1, storageQuotaMb: 1 })
    .lean()) as UserDoc[];
  const byId = new Map(users.map((user) => [user._id.toString(), user]));
  const topUsers = top.flatMap((row) => {
    const user = byId.get(row._id.toString());
    if (!user) return [];
    return [
      {
        id: row._id.toString(),
        email: user.email,
        displayName: user.displayName ?? null,
        username: user.username ?? null,
        usedBytes: row.bytes,
        quotaBytes: quotaBytesOf(app, user),
      },
    ];
  });
  return { disk, filesBytes, topUsers };
}
