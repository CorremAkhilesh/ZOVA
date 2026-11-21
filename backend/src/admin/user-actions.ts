import type { AdminBulkBody, AdminBulkResponse, AdminUserDetail } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../lib/errors.ts';
import { quotaBytesOf, storageUsage } from '../media/quota.ts';
import { devicesByUser } from '../push/admin-overview.ts';
import { deleteUserSubscriptions } from '../push/subscriptions.service.ts';
import { type Actor, assertNotSelf, audit, findTarget, setStorageQuota } from './admin.service.ts';
import { setUserStatus } from './user-status.ts';
import { toRows } from './users-list.ts';

/** Admin → Users → one person. Metadata only: no message, file name or file content. */
export async function userDetail(app: FastifyInstance, id: string): Promise<AdminUserDetail> {
  const target = await findTarget(app, id);
  const [[row], usage, devices] = await Promise.all([
    toRows(app, [target]),
    storageUsage(app, id),
    devicesByUser(app, [target._id]),
  ]);
  if (!row) throw new AppError('NOT_FOUND', 'User not found.');
  return {
    user: row,
    storage: { ...usage, quotaBytes: quotaBytesOf(app, target), custom: row.quotaCustom },
    devices: devices.get(id) ?? [],
  };
}

/**
 * Signs someone out of every device now: sockets close, sessions and push subscriptions go. They
 * can sign in again (unlike deactivation). Never yourself: Settings → Devices does that.
 */
export async function signOutEverywhere(
  app: FastifyInstance,
  actor: Actor,
  id: string,
  reason: string,
) {
  const target = await findTarget(app, id);
  assertNotSelf(actor, target, 'sign out');
  const context = await app.auth.$context;
  app.realtime.revokeUser(id, 'revoked');
  const revokedSessions = (await context.internalAdapter.listSessions(id)).length;
  await context.internalAdapter.deleteUserSessions(id);
  await deleteUserSubscriptions(app.mongo, id);
  await audit(app, actor, 'user.signout', target, {
    reason,
    details: { sessions: revokedSessions },
  });
  return { revokedSessions };
}

/**
 * One action for many people, one at a time, each through the same checks as alone (never
 * yourself, never the last admin). A refusal stops only that person.
 */
export async function bulkAction(
  app: FastifyInstance,
  actor: Actor,
  body: AdminBulkBody,
): Promise<AdminBulkResponse> {
  const results: AdminBulkResponse['results'] = [];
  for (const id of body.userIds) {
    try {
      if (body.action === 'deactivate')
        await setUserStatus(app, actor, id, 'deactivated', body.reason);
      if (body.action === 'reactivate') await setUserStatus(app, actor, id, 'active', body.reason);
      if (body.action === 'signOut') await signOutEverywhere(app, actor, id, body.reason);
      if (body.action === 'storageQuota') {
        await setStorageQuota(app, actor, id, body.quotaMb ?? null, body.reason);
      }
      results.push({ id, ok: true, code: null });
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      results.push({ id, ok: false, code: error.code });
    }
  }
  return { results };
}
