import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { statusApi } from '../feed';

/** "Viewed by" on my status: who, when, and any reaction. Nobody while my read receipts are off. */
export function ViewersSheet({ statusId, onClose }: { statusId: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const viewers = useQuery({
    queryKey: ['status-viewers', statusId],
    queryFn: () => statusApi.viewers(statusId),
  });
  const time = new Intl.DateTimeFormat(i18n.language, { timeStyle: 'short' });
  const list = viewers.data?.viewers ?? [];
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        title={t('updates.viewedBy', { count: viewers.data?.count ?? 0 })}
        className="max-w-sm"
      >
        {viewers.isPending ? (
          <div role="status" aria-label={t('common.loading')} className="space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : null}
        {viewers.isError ? (
          <p role="alert" className="text-sm text-danger">
            {t('updates.viewersFailed')}
          </p>
        ) : null}
        {viewers.isSuccess && list.length === 0 ? (
          <p className="text-sm text-text-muted">{t('updates.noViewers')}</p>
        ) : null}
        {list.length > 0 ? (
          <ul aria-label={t('updates.viewersList')} className="max-h-80 space-y-1 overflow-y-auto">
            {list.map((viewer) => (
              <li key={viewer.user.id} className="flex items-center gap-3 rounded-lg p-1.5">
                <Avatar
                  name={viewer.user.displayName}
                  src={viewer.user.avatar?.small}
                  className="size-10"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{viewer.user.displayName}</span>
                  <span className="text-xs text-text-muted">
                    {time.format(new Date(viewer.viewedAt))}
                  </span>
                </span>
                {viewer.reaction ? (
                  <span
                    role="img"
                    aria-label={t('updates.reacted', { emoji: viewer.reaction })}
                    className="text-xl"
                  >
                    {viewer.reaction}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
