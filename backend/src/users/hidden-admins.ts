import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { type UserDoc, usersModel } from './user-record.ts';

/**
 * The ADMIN_EMAILS accounts stay out of sight of normal users: not suggested, not found by name,
 * username or email, not addable to groups or mentionable, no status and no presence. A normal user
 * cannot start a chat with one; an admin can message anyone, and the person can answer in that chat
 * (ADMIN_CHAT_USER_CAN_REPLY). Admins see everyone. Existing chats are never touched.
 */

/** Lowercased, like the env and the stored emails. */
const adminEmails = (app: FastifyInstance) => app.env.ADMIN_EMAILS;

/** An ADMIN_EMAILS account: hidden from normal users. */
export const isHiddenAdmin = (app: FastifyInstance, user: Pick<UserDoc, 'email'>) =>
  adminEmails(app).includes(user.email.toLowerCase());

/** An admin sees everyone, hidden admins included. */
export const seesAdmins = (user: Pick<UserDoc, 'role'> | null | undefined) =>
  user?.role === 'admin';

/** Whether `viewerId` sees everyone. One lookup by _id. */
export async function viewerSeesAdmins(app: FastifyInstance, viewerId: string) {
  if (adminEmails(app).length === 0 || !Types.ObjectId.isValid(viewerId)) return true;
  const viewer = (await usersModel(app).findById(viewerId).select({ role: 1 }).lean()) as Pick<
    UserDoc,
    'role'
  > | null;
  return seesAdmins(viewer);
}

/** A user filter that leaves hidden admins out for this viewer (nothing for an admin). */
export async function hideAdminsFilter(
  app: FastifyInstance,
  viewerId: string,
): Promise<{ email?: { $nin: string[] } }> {
  return (await viewerSeesAdmins(app, viewerId)) ? {} : { email: { $nin: adminEmails(app) } };
}

/** The ids among `users` that `viewerId` must not see (empty for an admin viewer). */
export async function hiddenAmong(
  app: FastifyInstance,
  viewerId: string,
  users: Pick<UserDoc, '_id' | 'email'>[],
): Promise<Set<string>> {
  const admins = users.filter((user) => isHiddenAdmin(app, user));
  if (admins.length === 0 || (await viewerSeesAdmins(app, viewerId))) return new Set();
  return new Set(admins.map((user) => user._id.toString()));
}
