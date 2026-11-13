import type { GroupRole, GroupSettings } from '@zuvo/protocol';
import { AppError } from '../lib/errors.ts';

export const isAdminRole = (role: GroupRole) => role === 'owner' || role === 'admin';

const allowedBy = (audience: 'all' | 'admins', role: GroupRole) =>
  audience === 'all' || isAdminRole(role);

/** Every rule of who may do what in a group, with nothing else in it, so all of it can be tested. */
export const groupRules = {
  editInfo: (role: GroupRole, settings: GroupSettings) => allowedBy(settings.editInfo, role),
  sendMessages: (role: GroupRole, settings: GroupSettings) =>
    allowedBy(settings.sendMessages, role),
  addMembers: (role: GroupRole, settings: GroupSettings) => allowedBy(settings.addMembers, role),
  pinMessages: (role: GroupRole, settings: GroupSettings) => allowedBy(settings.pinMessages, role),
  /** The disappearing-messages timer: as the group's setting says (admins by default). */
  disappearing: (role: GroupRole, settings: GroupSettings) =>
    allowedBy(settings.disappearing, role),
  /** "@everyone": admins only, and nobody once the group turns it off. */
  mentionEveryone: (role: GroupRole, settings: GroupSettings) =>
    settings.mentionEveryone !== 'off' && isAdminRole(role),
  changeSettings: isAdminRole,
  manageInvite: isAdminRole,
  /** Admins can remove members. Only the owner can remove an admin, and nobody the owner. */
  removeMember(role: GroupRole, target: GroupRole) {
    if (target === 'owner') return false;
    return target === 'admin' ? role === 'owner' : isAdminRole(role);
  },
  changeRole: (role: GroupRole) => role === 'owner',
  transferOwnership: (role: GroupRole) => role === 'owner',
};

export function assertAllowed(allowed: boolean, message: string): void {
  if (!allowed) throw new AppError('FORBIDDEN', message);
}
