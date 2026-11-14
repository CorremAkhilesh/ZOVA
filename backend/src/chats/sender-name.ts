import type { FastifyInstance } from 'fastify';
import type { Types } from 'mongoose';
import { type UserDoc, usersModel } from '../users/user-record.ts';

/** Finds one user by id. Index: _id. */
export const senderNameQuery = (app: FastifyInstance, senderId: Types.ObjectId) =>
  usersModel(app).findById(senderId).select({ displayName: 1, email: 1, status: 1 });

/**
 * The name a group's chat list puts before its last message, kept in the chat's snapshot so the
 * preview reads "Asha: …" before anyone's profile is loaded. The same name their public profile
 * shows. Taken when the snapshot is written: after a rename, the old name stays until their next
 * message (a reader who has the new profile loaded sees that instead). Null when there is no
 * sender, or for a deactivated account (its profile says so).
 */
export async function senderNameOf(
  app: FastifyInstance,
  senderId: Types.ObjectId | null,
): Promise<string | null> {
  if (!senderId) return null;
  const user = (await senderNameQuery(app, senderId).lean()) as Pick<
    UserDoc,
    'displayName' | 'email' | 'status'
  > | null;
  if (!user || user.status === 'deactivated') return null;
  return user.displayName || user.email.split('@')[0] || null;
}
