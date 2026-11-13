import type { DisappearTimer } from '@zuvo/protocol';
import type { TFunction } from 'i18next';
import { groupAbilities } from '@/features/groups/rules';
import type { ChatRow } from '@/features/sync/local-db';

export const TIMERS: readonly DisappearTimer[] = ['off', '24h', '7d', '90d'];

/** Copies cached before the timer existed have none: off. */
export const timerOf = (chat: Pick<ChatRow, 'disappearing'>): DisappearTimer =>
  chat.disappearing ?? 'off';

/** Saved Messages has no timer; a 1:1 chat lets both people change it; a group, as set. */
export function timerAccess(chat: Pick<ChatRow, 'type' | 'group'>): 'hidden' | 'view' | 'change' {
  if (chat.type === 'self') return 'hidden';
  if (chat.type !== 'group') return 'change';
  return chat.group && groupAbilities(chat.group).disappearing ? 'change' : 'view';
}

/** "7 days", or "Off". */
export const timerLabel = (timer: DisappearTimer, t: TFunction) => t(`disappearing.timer.${timer}`);

/** Gone already: its time is up, even if the purge has not removed it yet. */
export const isExpired = (expiresAt: string | null | undefined, now = Date.now()) =>
  Boolean(expiresAt) && Date.parse(expiresAt ?? '') <= now;
