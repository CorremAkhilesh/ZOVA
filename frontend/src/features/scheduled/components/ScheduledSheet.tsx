import { useQueryClient } from '@tanstack/react-query';
import type { ScheduledMessage } from '@zuvo/protocol';
import { AlertCircle, Pencil, Send, Trash2 } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog, DialogContent } from '@/components/ui/dialog';
import { SCHEDULED_KEY, scheduledApi, useChatScheduled } from '../api';
import { scheduleErrorText } from '../errors';
import { scheduledPreview } from '../preview';
import { browserTimeZone, formatSendAt } from '../time';
import ScheduleDialog from './ScheduleDialog';

const LINE = 'py-6 text-center text-sm text-text-muted';

function ScheduledRow(props: {
  item: ScheduledMessage;
  onEdit: () => void;
  onSendNow: () => void;
  onDelete: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { item } = props;
  const preview = scheduledPreview(item);
  const time = formatSendAt(item.sendAt, i18n.language, browserTimeZone());
  const busy = item.status === 'sending';
  return (
    <li className="space-y-1.5 rounded-xl border bg-surface p-3">
      <p className="line-clamp-3 text-sm break-words">{preview}</p>
      <p className="text-xs text-text-muted">
        <time dateTime={item.sendAt}>{time}</time>
        {busy ? ` · ${t('scheduled.sending')}` : null}
      </p>
      {item.status === 'failed' ? (
        <p className="flex items-center gap-1.5 text-xs font-medium text-danger">
          <AlertCircle className="size-3.5" aria-hidden />
          {t('scheduled.failedLine', {
            reason: t(`scheduled.failure.${item.failure ?? 'other'}`),
          })}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1">
        {item.status === 'pending' ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={props.onEdit}
            aria-label={t('scheduled.editItem', { time })}
          >
            <Pencil className="size-4" aria-hidden />
            {t('scheduled.edit')}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={props.onSendNow}
          aria-label={t('scheduled.sendNowItem', { time })}
        >
          <Send className="size-4" aria-hidden />
          {t('scheduled.sendNow')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={busy}
          className="text-danger"
          onClick={props.onDelete}
          aria-label={t('scheduled.deleteItem', { time })}
        >
          <Trash2 className="size-4" aria-hidden />
          {t('scheduled.delete')}
        </Button>
      </div>
    </li>
  );
}

/** This chat's scheduled messages: change, send now, or cancel them. */
export default function ScheduledSheet({
  chatId,
  onClose,
}: {
  chatId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { data, isPending, isError, refetch } = useChatScheduled(chatId);
  const [editing, setEditing] = useState<ScheduledMessage | null>(null);
  const [deleting, setDeleting] = useState<ScheduledMessage | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: SCHEDULED_KEY });

  async function run(work: () => Promise<unknown>, done: string) {
    try {
      await work();
      toast.success(done);
    } catch (error) {
      toast.error(scheduleErrorText(error));
    } finally {
      void refresh();
    }
  }

  let body: ReactNode;
  if (isPending) body = <p className={LINE}>{t('common.loading')}</p>;
  else if (isError) {
    body = (
      <div className={LINE} role="alert">
        <p className="mb-2">{t('scheduled.loadFailed')}</p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          {t('common.retry')}
        </Button>
      </div>
    );
  } else if (data.length === 0) body = <p className={LINE}>{t('scheduled.empty')}</p>;
  else {
    body = (
      <ul className="space-y-2" aria-label={t('scheduled.listTitle')}>
        {data.map((item) => (
          <ScheduledRow
            key={item.id}
            item={item}
            onEdit={() => setEditing(item)}
            onSendNow={() => void run(() => scheduledApi.sendNow(item.id), t('scheduled.sentNow'))}
            onDelete={() => setDeleting(item)}
          />
        ))}
      </ul>
    );
  }

  return (
    <>
      <Dialog open={editing === null} onOpenChange={(open) => (open ? undefined : onClose())}>
        <DialogContent title={t('scheduled.listTitle')} className="max-w-lg">
          <div className="-mx-1 min-h-0 overflow-y-auto px-1">{body}</div>
        </DialogContent>
      </Dialog>
      {editing ? (
        <ScheduleDialog mode="edit" item={editing} onClose={() => setEditing(null)} />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? undefined : setDeleting(null))}
        title={t('scheduled.deleteTitle')}
        description={t('scheduled.deleteHint')}
        confirmLabel={t('scheduled.delete')}
        danger
        onConfirm={() => {
          const item = deleting;
          setDeleting(null);
          if (item) void run(() => scheduledApi.remove(item.id), t('scheduled.deleted'));
        }}
      />
    </>
  );
}
