import type { SystemEvent } from '@zuvo/protocol';
import type { TFunction } from 'i18next';

type Person = { id: string; name: string };

function listNames(people: Person[], me: string, t: TFunction): string {
  const names = people.map((person) => (person.id === me ? t('groups.youObject') : person.name));
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} ${t('groups.and')} ${names.at(-1)}`;
}

/** Settings have their own words for what people notice most: who may speak. */
function settingsKey(value: string | null): string {
  if (value?.includes('sendMessages:admins')) return 'groups.system.announcementOn';
  if (value?.includes('sendMessages:all')) return 'groups.system.announcementOff';
  return 'groups.system.settings_changed';
}

/** What a system message says, in the reader's language, with "You" where it is them. */
export function systemText(event: SystemEvent, me: string, t: TFunction): string {
  const { kind, actor, targets, value } = event;
  const you = actor?.id === me;
  const params = {
    actor: you ? t('groups.you') : (actor?.name ?? ''),
    targets: listNames(targets, me, t),
    value: value ?? '',
  };
  if (kind === 'owner_changed' && !actor) return t('groups.system.owner_auto', params);
  if (kind === 'settings_changed') return t(settingsKey(value), params);
  return t(`groups.system.${kind}`, params);
}

/** "Riya is typing…", "Riya and Vikram are typing…", "3 people are typing…". */
export function typingLine(names: string[], t: TFunction): string {
  const [first, second] = names;
  if (names.length === 0 || !first) return '';
  if (names.length === 1) return t('groups.typingOne', { name: first });
  if (names.length === 2) return t('groups.typingTwo', { first, second });
  return t('groups.typingMany', { count: names.length });
}

/** "Riya, Vikram, You…", as much as fits: the header truncates what it cannot show. */
export function memberNames(
  members: Array<{ user: { id: string; displayName: string | null } }>,
  me: string,
  you: string,
): string {
  const others = members
    .filter((member) => member.user.id !== me)
    .map((member) => member.user.displayName ?? '')
    .filter(Boolean);
  const hasMe = members.some((member) => member.user.id === me);
  return [...others, ...(hasMe ? [you] : [])].join(', ');
}
