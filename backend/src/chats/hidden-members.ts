import type { FastifyInstance } from 'fastify';
import type { Types } from 'mongoose';
import { registerChatModels } from '../db/chat-models.ts';
import { seesAdmins } from '../users/hidden-admins.ts';
import { type UserDoc, usersModel } from '../users/user-record.ts';

/**
 * A hidden admin in a group is left out of a normal member's member list, so the group's member
 * count leaves them out too. Admins see the full count.
 */

/** The ADMIN_EMAILS accounts (unique email index). */
async function hiddenAdminIds(app: FastifyInstance): Promise<Types.ObjectId[]> {
  const emails = app.env.ADMIN_EMAILS;
  if (emails.length === 0) return [];
  const rows = await usersModel(app)
    .find({ email: { $in: emails } })
    .select({ _id: 1 })
    .lean();
  return rows.map((row) => row._id);
}

/** Per group: how many current members `viewerId` must not count (none for an admin). */
export async function hiddenMemberCounts(
  app: FastifyInstance,
  viewerId: string,
  groupIds: Types.ObjectId[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (groupIds.length === 0) return counts;
  const admins = await hiddenAdminIds(app);
  if (admins.length === 0) return counts;
  const viewer = (await usersModel(app).findById(viewerId).select({ role: 1 }).lean()) as Pick<
    UserDoc,
    'role'
  > | null;
  if (seesAdmins(viewer)) return counts;
  // Index: { chatId, userId } unique.
  const rows = await registerChatModels(app.mongo)
    .ChatMember.find({ chatId: { $in: groupIds }, userId: { $in: admins }, leftAt: null })
    .select({ chatId: 1 })
    .lean();
  for (const row of rows) {
    const key = row.chatId.toString();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** For the people told about a group change: how many each must not count (keyed by user id). */
export async function hiddenCountsByMember(
  app: FastifyInstance,
  members: { userId: Types.ObjectId; leftAt?: Date | null }[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const admins = new Set((await hiddenAdminIds(app)).map(String));
  const inGroup = members.filter(
    (member) => !member.leftAt && admins.has(member.userId.toString()),
  ).length;
  if (inGroup === 0) return counts;
  const roles = (await usersModel(app)
    .find({ _id: { $in: members.map((member) => member.userId) } })
    .select({ role: 1 })
    .lean()) as Pick<UserDoc, '_id' | 'role'>[];
  for (const user of roles) {
    if (!seesAdmins(user)) counts.set(user._id.toString(), inGroup);
  }
  return counts;
}
