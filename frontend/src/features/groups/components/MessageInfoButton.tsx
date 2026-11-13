import { useQuery } from '@tanstack/react-query';
import type { MessageInfo } from '@zuvo/protocol';
import { Info } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { groupsApi } from '../api';

function People(props: { title: string; entries: MessageInfo['readBy'] }) {
  const { i18n } = useTranslation();
  if (props.entries.length === 0) return null;
  const format = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return (
    <section className="space-y-1">
      <h3 className="text-sm font-semibold">{props.title}</h3>
      <ul className="space-y-1">
        {props.entries.map(({ user, at }) => (
          <li key={user.id} className="flex items-center gap-2 text-sm">
            <Avatar
              name={user.displayName ?? ''}
              src={user.avatar?.small}
              className="size-7 text-xs"
            />
            <span className="min-w-0 flex-1 truncate">{user.displayName}</span>
            {at ? (
              <time dateTime={at} className="shrink-0 text-xs text-text-muted">
                {format.format(new Date(at))}
              </time>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Read by and delivered to, for my own message. The server applies the privacy rules. */
export function MessageInfoButton({ chatId, messageId }: { chatId: string; messageId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const info = useQuery({
    queryKey: ['message-info', messageId],
    queryFn: () => groupsApi.messageInfo(chatId, messageId),
    enabled: open,
    staleTime: 0,
  });
  return (
    <>
      <button
        type="button"
        aria-label={t('groups.messageInfo')}
        onClick={() => setOpen(true)}
        className="self-center rounded-full p-1 text-text-muted opacity-0 transition-opacity group-hover/message:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-60"
      >
        <Info className="size-4" aria-hidden />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={t('groups.messageInfo')} className="max-w-md">
          {info.isPending ? (
            <div
              role="status"
              aria-busy="true"
              aria-label={t('common.loading')}
              className="space-y-2"
            >
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : null}
          {info.isError ? (
            <p role="alert" className="text-sm text-danger">
              {t('groups.infoFailed')}
            </p>
          ) : null}
          {info.data ? (
            <div className="space-y-3">
              <People title={t('groups.readBy')} entries={info.data.readBy} />
              <People title={t('groups.deliveredTo')} entries={info.data.deliveredTo} />
              {info.data.waiting > 0 ? (
                <p className="text-sm text-text-muted">
                  {t('groups.waiting', { count: info.data.waiting })}
                </p>
              ) : null}
              {info.data.readBy.length + info.data.deliveredTo.length + info.data.waiting === 0 ? (
                <p className="text-sm text-text-muted">{t('groups.nobodyElse')}</p>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
