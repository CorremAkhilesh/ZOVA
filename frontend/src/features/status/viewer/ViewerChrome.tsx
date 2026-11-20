import type { Status } from '@zuvo/protocol';
import { Bell, BellOff, Flag, MoreVertical, Trash2, X } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Avatar } from '@/components/ui/avatar';
import { useModeration } from '@/features/moderation/store';
import { cn } from '@/lib/utils';
import { setMuted } from '../actions';
import { useStatusFeed } from '../feed';
import type { ViewerPerson } from './queue';

export const VIEWER_ICON_BUTTON =
  'grid size-11 shrink-0 place-items-center rounded-full text-white hover:bg-white/15 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-white/70';
const ITEM =
  'flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm outline-none data-[highlighted]:bg-background';

/** "5 minutes ago", in the reader's language. */
export function useAgo() {
  const { i18n } = useTranslation();
  const format = new Intl.RelativeTimeFormat(i18n.language, { numeric: 'auto' });
  return (iso: string) => {
    const minutes = Math.round((Date.parse(iso) - Date.now()) / 60_000);
    return Math.abs(minutes) < 60
      ? format.format(minutes, 'minute')
      : format.format(Math.round(minutes / 60), 'hour');
  };
}

/** One bar per status: full for those before, filling for this one, empty after. */
function ProgressBars(props: { total: number; index: number; progress: number }) {
  return (
    <div aria-hidden className="flex gap-1">
      {Array.from({ length: props.total }, (_, bar) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: one bar per position
        <span key={bar} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/35">
          <span
            className="block h-full rounded-full bg-white"
            style={{
              width: `${bar < props.index ? 100 : bar === props.index ? props.progress * 100 : 0}%`,
            }}
          />
        </span>
      ))}
    </div>
  );
}

interface HeaderProps {
  person: ViewerPerson;
  status: Status;
  index: number;
  progress: number;
  menuOpen: boolean;
  /** The viewer's own element: the menu opens inside it (its dialog), on top. */
  container: HTMLElement | null;
  onMenu: (open: boolean) => void;
  onDelete: () => void;
  onClose: () => void;
}

/**
 * Progress bars, who and when, ⋯ (mine: Delete; others: Mute, Report) and, on a phone, ✕ (wider
 * screens have it in the window's corner). The menu opens over the viewer; while it is open the
 * status waits (the viewer pauses on `menuOpen`).
 */
export function ViewerHeader(props: HeaderProps) {
  const { person, status } = props;
  const { t } = useTranslation();
  const ago = useAgo();
  const feed = useStatusFeed();
  const muted = feed?.people.find((item) => item.user.id === person.user.id)?.muted ?? false;
  const report = () =>
    useModeration
      .getState()
      .openReport({ target: { kind: 'status', statusId: status.id }, person: person.user });
  const mute = () =>
    void setMuted(person.user.id, !muted).catch(() => toast.error(t('updates.failed')));
  return (
    <div className="space-y-2.5 bg-gradient-to-b from-black/70 via-black/35 to-transparent px-3 pt-3 pb-6 md:bg-none md:px-1 md:pb-4">
      <ProgressBars total={person.statuses.length} index={props.index} progress={props.progress} />
      <div className="flex items-center gap-2.5">
        <Avatar
          name={person.user.displayName}
          src={person.user.avatar?.small}
          className="size-10 ring-2 ring-white/20"
        />
        <div className="min-w-0 flex-1 [text-shadow:0_1px_2px_rgb(0_0_0/0.6)]">
          <p className="truncate font-semibold">
            {person.mine ? t('updates.myStatus') : person.user.displayName}
          </p>
          <p className="text-xs text-white/85">{ago(status.createdAt)}</p>
        </div>
        <DropdownMenu.Root modal={false} open={props.menuOpen} onOpenChange={props.onMenu}>
          <DropdownMenu.Trigger asChild>
            <button type="button" aria-label={t('updates.more')} className={VIEWER_ICON_BUTTON}>
              <MoreVertical className="size-5" aria-hidden />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal container={props.container}>
            <DropdownMenu.Content
              side="bottom"
              align="end"
              sideOffset={6}
              collisionPadding={12}
              className="z-[1700] w-60 rounded-xl border bg-surface p-1.5 text-text shadow-xl motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=open]:zoom-in-95"
            >
              {person.mine ? (
                <DropdownMenu.Item className={cn(ITEM, 'text-danger')} onSelect={props.onDelete}>
                  <Trash2 className="size-4" aria-hidden />
                  {t('updates.delete')}
                </DropdownMenu.Item>
              ) : (
                <>
                  <DropdownMenu.Item className={ITEM} onSelect={mute}>
                    {muted ? (
                      <Bell className="size-4" aria-hidden />
                    ) : (
                      <BellOff className="size-4" aria-hidden />
                    )}
                    {t(muted ? 'updates.unmute' : 'updates.mute', {
                      name: person.user.displayName,
                    })}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item className={cn(ITEM, 'text-danger')} onSelect={report}>
                    <Flag className="size-4" aria-hidden />
                    {t('updates.report')}
                  </DropdownMenu.Item>
                </>
              )}
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
        <button
          type="button"
          aria-label={t('updates.close')}
          className={cn(VIEWER_ICON_BUTTON, 'md:hidden')}
          onClick={props.onClose}
        >
          <X className="size-6" aria-hidden />
        </button>
      </div>
    </div>
  );
}
