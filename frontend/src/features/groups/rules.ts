import type { GroupInfo, GroupRole } from '@zuvo/protocol';
import { create } from 'zustand';

/** What to offer. The server decides again on every request: this only keeps the screen honest. */
const isAdmin = (role: GroupRole) => role === 'owner' || role === 'admin';

export function groupAbilities(group: GroupInfo) {
  const { myRole, settings, active } = group;
  const allows = (audience: 'all' | 'admins') => active && (audience === 'all' || isAdmin(myRole));
  return {
    editInfo: allows(settings.editInfo),
    send: allows(settings.sendMessages),
    addMembers: allows(settings.addMembers),
    pin: allows(settings.pinMessages ?? 'all'),
    disappearing: allows(settings.disappearing ?? 'admins'),
    mentionEveryone: active && isAdmin(myRole) && settings.mentionEveryone !== 'off',
    manage: active && isAdmin(myRole),
    changeRoles: active && myRole === 'owner',
    transfer: active && myRole === 'owner',
    canRemove: (target: GroupRole) => {
      if (!active || target === 'owner') return false;
      return target === 'admin' ? myRole === 'owner' : isAdmin(myRole);
    },
  };
}

export const useNewGroup = create<{ isOpen: boolean; setOpen: (isOpen: boolean) => void }>(
  (set) => ({ isOpen: false, setOpen: (isOpen) => set({ isOpen }) }),
);

const PENDING_JOIN = 'zuvo.pending-join';

/**
 * Someone opened an invite link, or shared something to the app, signed out: signing in carries
 * on to it (`path` may include the query, as /share?id=… does).
 */
export function rememberJoinPath(path: string) {
  if (!path.startsWith('/join/') && !path.startsWith('/share')) return;
  try {
    sessionStorage.setItem(PENDING_JOIN, path);
  } catch {
    // Only means opening the link again after signing in.
  }
}

export function takeJoinPath(): string | null {
  try {
    const path = sessionStorage.getItem(PENDING_JOIN);
    sessionStorage.removeItem(PENDING_JOIN);
    return path;
  } catch {
    return null;
  }
}
