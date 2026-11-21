import type { AdminUser, AuditAction, AuditLogEntry, SessionUser } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { chatModels } from '../chats/chats.service.ts';
import { registerSecurityModels } from '../db/security-models.ts';
import { AppError } from '../lib/errors.ts';
import { quotaBytesOf } from '../media/quota.ts';
import { loadUser, type UserDoc, usersModel } from '../users/user-record.ts';

export interface Actor {
  id: string;
  email: string;
  ipAddress: string | null;
}

export const toAdminUser = (user: UserDoc): AdminUser => ({
  id: user._id.toString(),
  email: user.email,
  displayName: user.displayName ?? null,
  username: user.username ?? null,
  role: user.role === 'admin' ? 'admin' : 'user',
  status: user.status === 'deactivated' ? 'deactivated' : 'active',
  lastLoginAt: user.lastLoginAt ? new Date(user.lastLoginAt).toISOString() : null,
  createdAt: new Date(user.createdAt).toISOString(),
});

/** The filter behind each person's storage figure. */
export const storageFilter = (ownerIds: Types.ObjectId[]) => ({
  ownerId: { $in: ownerIds },
  status: 'ready' as const,
});

/** Total bytes of finished files per person (index: ownerId + status + size). */
export async function storageByOwner(app: FastifyInstance, ownerIds: Types.ObjectId[]) {
  const rows = await chatModels(app).Media.aggregate<{ _id: Types.ObjectId; bytes: number }>([
    { $match: storageFilter(ownerIds) },
    { $group: { _id: '$ownerId', bytes: { $sum: '$size' } } },
  ]);
  return new Map(rows.map((row) => [row._id.toString(), row.bytes]));
}

export async function findTarget(app: FastifyInstance, id: string): Promise<UserDoc> {
  const user = Types.ObjectId.isValid(id) ? await loadUser(app, id) : null;
  if (!user) throw new AppError('NOT_FOUND', 'User not found.');
  return user;
}

/** Throws LAST_ADMIN when `target` is the only active admin (index: role + status). */
export async function assertNotLastAdmin(app: FastifyInstance, target: UserDoc): Promise<void> {
  if (target.role !== 'admin' || target.status === 'deactivated') return;
  const admins = await usersModel(app).countDocuments({ role: 'admin', status: 'active' });
  if (admins <= 1) throw new AppError('LAST_ADMIN', 'There must always be at least one admin.');
}

export function assertNotSelf(actor: Actor, target: UserDoc, what: string): void {
  if (target._id.toString() === actor.id)
    throw new AppError('CONFLICT', `You cannot ${what} your own account.`);
}

export async function setRole(
  app: FastifyInstance,
  actor: Actor,
  id: string,
  role: SessionUser['role'],
  reason: string,
) {
  const target = await findTarget(app, id);
  if (role === 'user') {
    assertNotSelf(actor, target, 'demote');
    await assertNotLastAdmin(app, target);
  }
  if ((target.role ?? 'user') !== role) {
    await usersModel(app).updateOne({ _id: target._id }, { $set: { role } });
    await audit(app, actor, role === 'admin' ? 'user.promote' : 'user.demote', target, {
      reason,
    });
  }
  return toAdminUser({ ...target, role });
}

/** One person's storage limit in MiB; null puts the default back. Audited when it changes. */
export async function setStorageQuota(
  app: FastifyInstance,
  actor: Actor,
  id: string,
  quotaMb: number | null,
  reason: string,
) {
  const target = await findTarget(app, id);
  const before = target.storageQuotaMb ?? null;
  if (before !== quotaMb) {
    await usersModel(app).updateOne({ _id: target._id }, { $set: { storageQuotaMb: quotaMb } });
    // null on either side: the default limit at the time.
    await audit(app, actor, 'storage.quota', target, {
      reason,
      details: {
        fromMb: before,
        toMb: quotaMb,
        defaultMb: app.settings.current().mediaUserQuotaMb,
      },
    });
  }
  return { quotaBytes: quotaBytesOf(app, { storageQuotaMb: quotaMb }), custom: quotaMb !== null };
}

/** Why and what changed, kept with the audit entry. */
export interface AuditExtra {
  reason?: string | null;
  details?: Record<string, string | number | null> | null;
}

export async function audit(
  app: FastifyInstance,
  actor: Actor,
  action: AuditAction,
  target: Pick<UserDoc, 'email'> & { _id: { toString(): string } },
  extra: AuditExtra = {},
) {
  await registerSecurityModels(app.mongo).AuditLog.create({
    action,
    actorId: actor.id,
    actorEmail: actor.email,
    targetId: target._id.toString(),
    targetEmail: target.email,
    ipAddress: actor.ipAddress,
    at: new Date(),
    reason: extra.reason ?? null,
    details: extra.details ?? null,
  });
}

const encodeCursor = (at: Date, id: Types.ObjectId) => `${at.getTime()}_${id.toString()}`;

function decodeCursor(cursor: string | undefined) {
  const [time, id] = cursor?.split('_') ?? [];
  if (!time || !id || !Types.ObjectId.isValid(id) || !/^\d+$/.test(time)) return null;
  return { at: new Date(Number(time)), id: new Types.ObjectId(id) };
}

/** Admin → Audit log, newest first, cursor on (at, _id) — index { at: -1, _id: -1 }. */
export async function listAudit(app: FastifyInstance, limit: number, cursor?: string) {
  const after = decodeCursor(cursor);
  const filter = after
    ? { $or: [{ at: { $lt: after.at } }, { at: after.at, _id: { $lt: after.id } }] }
    : {};
  const docs = await registerSecurityModels(app.mongo)
    .AuditLog.find(filter)
    .sort({ at: -1, _id: -1 })
    .limit(limit + 1)
    .lean();
  const items = docs.slice(0, limit);
  const last = items.at(-1);
  return {
    items: items.map(
      (doc): AuditLogEntry => ({
        id: doc._id.toString(),
        action: doc.action as AuditAction,
        actor: { id: doc.actorId, email: doc.actorEmail },
        target: { id: doc.targetId, email: doc.targetEmail },
        ipAddress: doc.ipAddress,
        at: doc.at.toISOString(),
        reason: doc.reason ?? null,
        details: doc.details ?? null,
      }),
    ),
    nextCursor: docs.length > limit && last ? encodeCursor(last.at, last._id) : null,
  };
}
