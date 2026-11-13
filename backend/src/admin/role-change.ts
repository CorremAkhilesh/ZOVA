import { normalizeEmail } from '@zuvo/protocol';
import type { Connection, Model } from 'mongoose';
import { registerAuthModels } from '../db/auth-models.ts';
import { registerSecurityModels } from '../db/security-models.ts';
import { AppError } from '../lib/errors.ts';
import type { UserDoc } from '../users/user-record.ts';

export type Role = 'admin' | 'user';

/** Who changed a role, as written to the audit log. */
export interface RoleActor {
  id: string;
  email: string;
  ipAddress: string | null;
}

/** ADMIN_EMAILS promotion on sign-in. */
export const SYSTEM_ACTOR: RoleActor = {
  id: 'system',
  email: 'system (ADMIN_EMAILS)',
  ipAddress: null,
};

/** The emergency `admin:role` script. */
export const CLI_ACTOR: RoleActor = { id: 'cli', email: 'cli (admin:role)', ipAddress: null };

export interface RoleChangeResult {
  changed: boolean;
  userId: string;
  email: string;
  role: Role;
}

const users = (connection: Connection) =>
  registerAuthModels(connection).AuthUser as unknown as Model<UserDoc>;

/**
 * Sets `role` for the account with `email`, audited. Refuses to remove the last active admin
 * (index: role + status). No change, no audit entry.
 */
export async function changeRoleByEmail(
  connection: Connection,
  input: { email: string; role: Role; actor: RoleActor },
): Promise<RoleChangeResult> {
  const email = normalizeEmail(input.email);
  const user = (await users(connection).findOne({ email }).lean()) as UserDoc | null;
  if (!user) throw new AppError('NOT_FOUND', `No account for ${email}.`);
  const current: Role = user.role === 'admin' ? 'admin' : 'user';
  const result = { userId: user._id.toString(), email, role: input.role };
  if (current === input.role) return { ...result, changed: false };

  if (input.role === 'user' && user.status !== 'deactivated') {
    const otherAdmins = await users(connection).countDocuments({
      role: 'admin',
      status: 'active',
      _id: { $ne: user._id },
    });
    if (otherAdmins === 0) {
      throw new AppError('LAST_ADMIN', 'There must always be at least one admin.');
    }
  }

  await users(connection).updateOne({ _id: user._id }, { $set: { role: input.role } });
  await auditRoleChange(connection, input.actor, input.role, { id: result.userId, email });
  return { ...result, changed: true };
}

async function auditRoleChange(
  connection: Connection,
  actor: RoleActor,
  role: Role,
  target: { id: string; email: string },
): Promise<void> {
  await registerSecurityModels(connection).AuditLog.create({
    action: role === 'admin' ? 'user.promote' : 'user.demote',
    actorId: actor.id,
    actorEmail: actor.email,
    targetId: target.id,
    targetEmail: target.email,
    ipAddress: actor.ipAddress,
    at: new Date(),
  });
}
