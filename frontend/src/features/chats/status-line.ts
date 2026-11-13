import type { TFunction } from 'i18next';
import { dayKind, formatClock } from './chat-utils';

/** "last seen today at 8:56 AM", "last seen yesterday at …" or "last seen 12 Oct". */
export function formatLastSeen(at: Date, now: Date, locale: string, t: TFunction): string {
  const time = formatClock(at, locale);
  const kind = dayKind(at, now);
  if (kind === 'today') return t('conversation.lastSeenToday', { time });
  if (kind === 'yesterday') return t('conversation.lastSeenYesterday', { time });
  const date = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(at.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  }).format(at);
  return t('conversation.lastSeenDate', { date });
}

interface StatusInput {
  typing: boolean;
  presence: { online: boolean; lastSeenAt: string | null } | undefined;
}

/** What the header says under the name. Empty when there is nothing to say, or it is hidden. */
export function statusLine(
  { typing, presence }: StatusInput,
  now: Date,
  locale: string,
  t: TFunction,
): string {
  if (typing) return t('conversation.typing');
  if (presence?.online) return t('conversation.online');
  if (presence?.lastSeenAt) return formatLastSeen(new Date(presence.lastSeenAt), now, locale, t);
  return '';
}
