import type { PublicProfile, Status } from '@zuvo/protocol';
import type { TFunction } from 'i18next';
import { Bell, BellOff, MoreHorizontal, Plus } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Avatar } from '@/components/ui/avatar';
import { setMuted } from '../actions';
import { useAgo } from '../viewer/ViewerChrome';
import { StatusRing } from './StatusRing';

const ITEM =
  'flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-background';

interface StatusRowProps {
  user: PublicProfile;
  statuses: Status[];
  mine?: boolean;
  muted?: boolean;
  onOpen: () => void;
}

/** Under the name: when the latest one was posted (mine: how many, and when; none: how to add). */
function rowDetail(
  statuses: Status[],
  mine: boolean,
  ago: (iso: string) => string,
  t: TFunction,
): string {
  const latest = statuses.at(-1);
  if (!latest) return t('updates.addHint');
  if (!mine) return ago(latest.createdAt);
  return t('updates.updates', { count: statuses.length, time: ago(latest.createdAt) });
}

/** A person in the list: their photo in a ring (one part per status), name and latest time. */
export function StatusRow({ user, statuses, mine = false, muted = false, onOpen }: StatusRowProps) {
  const { t } = useTranslation();
  const ago = useAgo();
  const seen = mine ? statuses.length : statuses.filter((status) => status.viewed).length;
  const name = mine ? t('updates.myStatus') : user.displayName;
  const detail = rowDetail(statuses, mine, ago, t);
  const unseen = !mine && seen < statuses.length ? `, ${t('updates.unseen')}` : '';
  return (
    <li className="group flex items-center gap-1 pr-2">
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${name}, ${detail}${unseen}`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-4 py-2 text-left hover:bg-background focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand/40"
      >
        <span className="relative">
          {statuses.length > 0 ? (
            <StatusRing total={statuses.length} seen={seen}>
              <Avatar name={user.displayName} src={user.avatar?.small} className="size-11" />
            </StatusRing>
          ) : (
            <span className="grid size-[52px] place-items-center">
              <Avatar name={user.displayName} src={user.avatar?.small} className="size-11" />
            </span>
          )}
          {mine && statuses.length === 0 ? (
            <span className="absolute right-0 bottom-0 grid size-5 place-items-center rounded-full border-2 border-surface bg-brand text-brand-foreground">
              <Plus className="size-3" aria-hidden />
            </span>
          ) : null}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block truncate font-semibold ${muted ? 'text-text-muted' : ''}`}>
            {name}
          </span>
          <span className="block truncate text-sm text-text-muted">{detail}</span>
        </span>
      </button>
      {mine ? null : (
        <DropdownMenu.Root modal={false}>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              aria-label={t('updates.actionsFor', { name: user.displayName })}
              className="grid size-11 place-items-center rounded-full text-text-muted hover:bg-background hover:text-text focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-brand/40"
            >
              <MoreHorizontal className="size-5" aria-hidden />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              className="z-[1500] w-56 rounded-xl border bg-surface p-1.5 shadow-lg"
            >
              <DropdownMenu.Item
                className={ITEM}
                onSelect={() =>
                  void setMuted(user.id, !muted).catch(() => toast.error(t('updates.failed')))
                }
              >
                {muted ? (
                  <Bell className="size-4" aria-hidden />
                ) : (
                  <BellOff className="size-4" aria-hidden />
                )}
                {t(muted ? 'updates.unmute' : 'updates.mute', { name: user.displayName })}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
    </li>
  );
}
