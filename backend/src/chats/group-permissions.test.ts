import { DEFAULT_GROUP_SETTINGS, type GroupRole } from '@zuvo/protocol';
import { describe, expect, it } from 'vitest';
import { groupRules } from './group-permissions.ts';

const ROLES: GroupRole[] = ['owner', 'admin', 'member'];
const open = {
  editInfo: 'all',
  sendMessages: 'all',
  addMembers: 'all',
  pinMessages: 'all',
  mentionEveryone: 'admins',
  disappearing: 'admins',
} as const;
const closed = {
  editInfo: 'admins',
  sendMessages: 'admins',
  addMembers: 'admins',
  pinMessages: 'admins',
  mentionEveryone: 'off',
  disappearing: 'admins',
} as const;
const who = (rule: (role: GroupRole) => boolean) => ROLES.filter((role) => rule(role));

describe('what each role may do', () => {
  it.each(['editInfo', 'sendMessages', 'addMembers', 'pinMessages'] as const)(
    '%s follows its setting',
    (key) => {
      expect(who((role) => groupRules[key](role, open))).toEqual(ROLES);
      expect(who((role) => groupRules[key](role, closed))).toEqual(['owner', 'admin']);
    },
  );

  it('lets only admins say @everyone, and nobody once it is off', () => {
    expect(who((role) => groupRules.mentionEveryone(role, open))).toEqual(['owner', 'admin']);
    expect(who((role) => groupRules.mentionEveryone(role, closed))).toEqual([]);
  });

  it('starts with members able to talk and edit, but only admins adding people', () => {
    expect(groupRules.sendMessages('member', DEFAULT_GROUP_SETTINGS)).toBe(true);
    expect(groupRules.editInfo('member', DEFAULT_GROUP_SETTINGS)).toBe(true);
    expect(groupRules.addMembers('member', DEFAULT_GROUP_SETTINGS)).toBe(false);
  });

  it('lets only admins change settings and the invite link', () => {
    expect(who(groupRules.changeSettings)).toEqual(['owner', 'admin']);
    expect(who(groupRules.manageInvite)).toEqual(['owner', 'admin']);
  });

  it('lets only the owner change admins or hand over the group', () => {
    expect(who(groupRules.changeRole)).toEqual(['owner']);
    expect(who(groupRules.transferOwnership)).toEqual(['owner']);
  });

  it.each([
    ['owner', 'admin', true],
    ['owner', 'member', true],
    ['admin', 'member', true],
    ['admin', 'admin', false],
    ['admin', 'owner', false],
    ['member', 'member', false],
    ['member', 'admin', false],
    ['owner', 'owner', false],
  ] as const)('%s removing %s: %s', (role, target, allowed) => {
    expect(groupRules.removeMember(role, target)).toBe(allowed);
  });
});
