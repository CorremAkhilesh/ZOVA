import type { AdminUser, AuditAction, AuditLogEntry, SessionUser } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { chatModels } from '../chats/chats.service.ts';
import { registerSecurityModels } from '../db/security-models.ts';
import { AppError } from '../lib/errors.ts';
import { escapeRegex, loadUser, type UserDoc, usersModel } from '../users/user-record.ts';

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
async function storageByOwner(app: FastifyInstance, ownerIds: Types.ObjectId[]) {
  const rows = await chatModels(app).Media.aggregate<{ _id: Types.ObjectId; bytes: number }>([
    { $match: storageFilter(ownerIds) },
    { $group: { _id: '$ownerId', bytes: { $sum: '$size' } } },
  ]);
  return new Map(rows.map((row) => [row._id.toString(), row.bytes]));
}

/**
 * Admin → Users, newest first, cursor on _id (default _id index). `q` with "@" is an email
 * prefix (unique email index), otherwise name/username word prefixes (searchTerms index).
 */
export async function listUsers(app: FastifyInstance, q: string, limit: number, cursor?: string) {
  const text = q.trim().toLocaleLowerCase();
  const filter: Record<string, unknown> = {};
  if (text.includes('@')) filter.email = new RegExp(`^${escapeRegex(text)}`);
  else if (text) {
    const words = text.split(/\s+/).slice(0, 5);
    filter.searchTerms = { $all: words.map((word) => new RegExp(`^${escapeRegex(word)}`)) };
  }
  if (cursor && Types.ObjectId.isValid(cursor)) filter._id = { $lt: new Types.ObjectId(cursor) };
  const docs = (await usersModel(app)
    .find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean()) as UserDoc[];
  const items = docs.slice(0, limit);
  const next = docs.length > limit ? (items.at(-1)?._id.toString() ?? null) : null;
  const stored = await storageByOwner(
    app,
    items.map((user) => user._id),
  );
  return {
    items: items.map((user) => ({
      ...toAdminUser(user),
      storageBytes: stored.get(user._id.toString()) ?? 0,
    })),
    nextCursor: next,
  };
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
) {
  const target = await findTarget(app, id);
  if (role === 'user') {
    assertNotSelf(actor, target, 'demote');
    await assertNotLastAdmin(app, target);
  }
  if ((target.role ?? 'user') !== role) {
    await usersModel(app).updateOne({ _id: target._id }, { $set: { role } });
    await audit(app, actor, role === 'admin' ? 'user.promote' : 'user.demote', target);
  }
  return toAdminUser({ ...target, role });
}

export async function audit(
  app: FastifyInstance,
  actor: Actor,
  action: AuditAction,
  target: UserDoc,
) {
  await registerSecurityModels(app.mongo).AuditLog.create({
    action,
    actorId: actor.id,
    actorEmail: actor.email,
    targetId: target._id.toString(),
    targetEmail: target.email,
    ipAddress: actor.ipAddress,
    at: new Date(),
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
      }),
    ),
    nextCursor: docs.length > limit && last ? encodeCursor(last.at, last._id) : null,
  };
}
