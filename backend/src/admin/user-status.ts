import type { FastifyInstance } from 'fastify';
import { onUserDeactivated, onUserReactivated } from '../chats/group-ownership.service.ts';
import { deleteUserSubscriptions } from '../push/subscriptions.service.ts';
import { usersModel } from '../users/user-record.ts';
import {
  type Actor,
  assertNotLastAdmin,
  assertNotSelf,
  audit,
  findTarget,
} from './admin.service.ts';

/**
 * Deactivates or reactivates someone. Deactivation revokes every session at once and passes on
 * their groups. Audited; never yourself, never the last admin. Used by Admin → Users and → Reports.
 */
export async function setUserStatus(
  app: FastifyInstance,
  actor: Actor,
  id: string,
  status: 'active' | 'deactivated',
) {
  const target = await findTarget(app, id);
  if (status === 'deactivated') {
    assertNotSelf(actor, target, 'deactivate');
    await assertNotLastAdmin(app, target);
  }
  const context = await app.auth.$context;
  let revokedSessions = 0;
  if ((target.status ?? 'active') !== status) {
    // Block new logins and socket connections first, then close what is open.
    await usersModel(app).updateOne({ _id: target._id }, { $set: { status } });
    await audit(
      app,
      actor,
      status === 'deactivated' ? 'user.deactivate' : 'user.reactivate',
      target,
    );
  }
  if (status === 'deactivated') {
    // Sockets first, so they hear "deactivated" rather than a plain session revocation.
    app.realtime.revokeUser(id, 'deactivated');
    revokedSessions = (await context.internalAdapter.listSessions(id)).length;
    await context.internalAdapter.deleteUserSessions(id);
    // Each deleted session takes its pushes with it; this also catches any left over.
    await deleteUserSubscriptions(app.mongo, id);
    await onUserDeactivated(app, id);
  } else {
    await onUserReactivated(app, id);
  }
  app.log.info(
    { targetUserId: id, adminId: actor.id, status, revokedSessions },
    'user status changed',
  );
  return { user: { id, email: target.email, status }, revokedSessions };
}
