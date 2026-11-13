import type { GroupInfo, SystemEvent } from '@zuvo/protocol';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { i18n } from '@/lib/i18n';
import { inviteUrl } from './components/GroupInviteSection';
import { groupAbilities, rememberJoinPath, takeJoinPath } from './rules';
import { memberNames, systemText, typingLine } from './wording';

const t = i18n.getFixedT('en') as TFunction;
const asha = { id: 'a', name: 'Asha' };
const bharat = { id: 'b', name: 'Bharat' };
const chitra = { id: 'c', name: 'Chitra' };
const event = (overrides: Partial<SystemEvent>): SystemEvent => ({
  kind: 'left',
  actor: asha,
  targets: [],
  value: null,
  ...overrides,
});

describe('typing', () => {
  it('names one or two people, and counts more', () => {
    expect(typingLine([], t)).toBe('');
    expect(typingLine(['Riya'], t)).toBe('Riya is typing…');
    expect(typingLine(['Riya', 'Vikram'], t)).toBe('Riya and Vikram are typing…');
    expect(typingLine(['Riya', 'Vikram', 'Asha'], t)).toBe('3 people are typing…');
  });
});

describe('system messages', () => {
  it.each([
    ['created', { value: 'Launch' }, 'Asha created the group “Launch”'],
    ['added', { targets: [bharat] }, 'Asha added Bharat'],
    ['added', { targets: [bharat, chitra] }, 'Asha added Bharat and Chitra'],
    ['removed', { targets: [bharat] }, 'Asha removed Bharat'],
    ['left', {}, 'Asha left'],
    ['joined', {}, 'Asha joined using the invite link'],
    ['renamed', { value: 'New' }, 'Asha changed the group name to “New”'],
    ['photo_changed', {}, 'Asha changed the group photo'],
    ['description_changed', {}, 'Asha changed the group description'],
    ['promoted', { targets: [bharat] }, 'Asha made Bharat an admin'],
    ['demoted', { targets: [bharat] }, 'Asha removed Bharat as admin'],
    ['owner_changed', { targets: [bharat] }, 'Asha made Bharat the owner'],
  ] as const)('%s reads properly', (kind, extra, text) => {
    expect(
      systemText(
        event({ kind, ...extra, targets: [...('targets' in extra ? extra.targets : [])] }),
        'z',
        t,
      ),
    ).toBe(text);
  });

  it('says "You" when it was me, either way round', () => {
    expect(systemText(event({ kind: 'left' }), 'a', t)).toBe('You left');
    expect(systemText(event({ kind: 'added', targets: [bharat] }), 'b', t)).toBe('Asha added you');
  });

  it('has words for announcement mode, and for other settings', () => {
    const settings = (value: string) =>
      systemText(event({ kind: 'settings_changed', value }), 'z', t);
    expect(settings('sendMessages:admins')).toContain('only admins can send');
    expect(settings('sendMessages:all')).toContain('everyone can send');
    expect(settings('addMembers:all')).toBe('Asha changed the group settings');
  });

  it('needs no person when the system handed over ownership', () => {
    const text = systemText(
      event({ kind: 'owner_changed', actor: null, targets: [bharat] }),
      'z',
      t,
    );
    expect(text).toBe('Bharat is now the owner');
  });
});

describe('the header', () => {
  const member = (id: string, displayName: string | null) => ({ user: { id, displayName } });

  it('lists the others, then me', () => {
    expect(
      memberNames([member('me', 'Me'), member('r', 'Riya'), member('v', 'Vikram')], 'me', 'You'),
    ).toBe('Riya, Vikram, You');
  });

  it('skips people with no name yet', () => {
    expect(memberNames([member('r', null), member('v', 'Vikram')], 'me', 'You')).toBe('Vikram');
  });
});

describe('what the app offers', () => {
  const group = (overrides: Partial<GroupInfo> = {}): GroupInfo => ({
    name: 'Team',
    description: '',
    photo: null,
    memberCount: 3,
    settings: {
      editInfo: 'all',
      sendMessages: 'all',
      addMembers: 'admins',
      pinMessages: 'all',
      mentionEveryone: 'admins',
      disappearing: 'admins',
    },
    myRole: 'member',
    active: true,
    ...overrides,
  });

  it('a member can talk and edit, but not manage or add', () => {
    const abilities = groupAbilities(group());
    expect(abilities).toMatchObject({
      send: true,
      editInfo: true,
      addMembers: false,
      manage: false,
      changeRoles: false,
      transfer: false,
    });
    expect(abilities.canRemove('member')).toBe(false);
  });

  it('an admin can manage and remove members, not admins or the owner', () => {
    const abilities = groupAbilities(group({ myRole: 'admin' }));
    expect(abilities).toMatchObject({ manage: true, addMembers: true, changeRoles: false });
    expect(abilities.canRemove('member')).toBe(true);
    expect(abilities.canRemove('admin')).toBe(false);
    expect(abilities.canRemove('owner')).toBe(false);
  });

  it('the owner can do everything but remove themselves', () => {
    const abilities = groupAbilities(group({ myRole: 'owner' }));
    expect(abilities).toMatchObject({ changeRoles: true, transfer: true });
    expect(abilities.canRemove('admin')).toBe(true);
    expect(abilities.canRemove('owner')).toBe(false);
  });

  it('announcement mode stops members only', () => {
    const settings = {
      editInfo: 'all',
      sendMessages: 'admins',
      addMembers: 'admins',
      pinMessages: 'all',
      mentionEveryone: 'admins',
      disappearing: 'admins',
    } as const;
    expect(groupAbilities(group({ settings })).send).toBe(false);
    expect(groupAbilities(group({ settings, myRole: 'admin' })).send).toBe(true);
  });

  it('someone who left can do nothing', () => {
    const abilities = groupAbilities(group({ myRole: 'owner', active: false }));
    expect(abilities).toMatchObject({
      send: false,
      editInfo: false,
      manage: false,
      transfer: false,
    });
    expect(abilities.canRemove('member')).toBe(false);
  });
});

describe('invite links', () => {
  it('are built from where the app lives', () => {
    expect(inviteUrl('abc', 'https://app.example')).toBe('https://app.example/join/abc');
  });

  it('survive signing in, once', () => {
    rememberJoinPath('/chats/1');
    expect(takeJoinPath()).toBeNull();
    rememberJoinPath('/join/abc');
    expect(takeJoinPath()).toBe('/join/abc');
    expect(takeJoinPath()).toBeNull();
  });
});
