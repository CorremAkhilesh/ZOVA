import type { Status } from '@zuvo/protocol';
import { Bell, BellOff, Flag, MoreVertical, Trash2, X } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useModeration } from '@/features/moderation/store';
import { deleteMyStatus, setMuted } from '../actions';
import { useStatusFeed } from '../feed';
import type { ViewerPerson } from './queue';

const ICON_BUTTON =
  'grid size-11 shrink-0 place-items-center rounded-full text-white hover:bg-white/15 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-white/70';
const ITEM =
  'flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm outline-none data-[highlighted]:bg-background';

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
function ProgressBars({
  total,
  index,
  progress,
}: {
  total: number;
  index: number;
  progress: number;
}) {
  return (
    <div aria-hidden className="flex gap-1">
      {Array.from({ length: total }, (_, bar) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: one bar per position
        <span key={bar} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/35">
          <span
            className="block h-full rounded-full bg-white"
            style={{ width: `${bar < index ? 100 : bar === index ? progress * 100 : 0}%` }}
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
  onMenu: (open: boolean) => void;
  onDelete: () => void;
  onClose: () => void;
}

export function ViewerHeader({
  person,
  status,
  index,
  progress,
  onMenu,
  onDelete,
  onClose,
}: HeaderProps) {
  const { t } = useTranslation();
  const ago = useAgo();
  const feed = useStatusFeed();
  const muted = feed?.people.find((item) => item.user.id === person.user.id)?.muted ?? false;
  const report = () =>
    useModeration
      .getState()
      .openReport({ target: { kind: 'status', statusId: status.id }, person: person.user });
  return (
    <div className="space-y-2 bg-gradient-to-b from-black/60 to-transparent px-3 pt-2 pb-3">
      <ProgressBars total={person.statuses.length} index={index} progress={progress} />
      <div className="flex items-center gap-2">
        <Avatar
          name={person.user.displayName}
          src={person.user.avatar?.small}
          className="size-10"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">
            {person.mine ? t('updates.myStatus') : person.user.displayName}
          </p>
          <p className="text-xs text-white/80">{ago(status.createdAt)}</p>
        </div>
        <DropdownMenu.Root modal={false} onOpenChange={onMenu}>
          <DropdownMenu.Trigger asChild>
            <button type="button" aria-label={t('updates.more')} className={ICON_BUTTON}>
              <MoreVertical className="size-5" aria-hidden />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              className="z-[1700] w-56 rounded-xl border bg-surface p-1.5 text-text shadow-lg"
            >
              {person.mine ? (
                <DropdownMenu.Item className={`${ITEM} text-danger`} onSelect={onDelete}>
                  <Trash2 className="size-4" aria-hidden />
                  {t('updates.delete')}
                </DropdownMenu.Item>
              ) : (
                <>
                  <DropdownMenu.Item
                    className={ITEM}
                    onSelect={() => {
                      void setMuted(person.user.id, !muted).catch(() =>
                        toast.error(t('updates.failed')),
                      );
                    }}
                  >
                    {muted ? (
                      <Bell className="size-4" aria-hidden />
                    ) : (
                      <BellOff className="size-4" aria-hidden />
                    )}
                    {t(muted ? 'updates.unmute' : 'updates.mute', {
                      name: person.user.displayName,
                    })}
                  </DropdownMenu.Item>
                  <DropdownMenu.Item className={`${ITEM} text-danger`} onSelect={report}>
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
          className={ICON_BUTTON}
          onClick={onClose}
        >
          <X className="size-5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

/** "Delete this status?": it goes for everyone who could see it. */
export function DeleteStatusDialog(props: {
  status: Status;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent
        title={t('updates.deleteTitle')}
        description={t('updates.deleteBody')}
        className="max-w-sm"
      >
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={props.onClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              props.onClose();
              void deleteMyStatus(props.status)
                .then(() => toast.success(t('updates.deleted')))
                .catch(() => toast.error(t('updates.failed')));
              props.onDeleted();
            }}
          >
            {t('updates.delete')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
