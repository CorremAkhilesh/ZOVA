import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AdminAnnouncement } from '@zuvo/protocol';
import { Megaphone, Plus } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { authErrorMessage } from '@/features/auth/errors';
import { AdminPage } from '../admin/components/AdminLayout';
import { ReasonDialog } from '../admin/users/ReasonDialog';
import { announcementsApi } from './api';
import { NewAnnouncementDialog } from './NewAnnouncementDialog';

function Row({ item, onEnd }: { item: AdminAnnouncement; onEnd: () => void }) {
  const { t, i18n } = useTranslation();
  const date = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );
  const how = [
    item.banner ? t('adminPanel.announcements.banner') : null,
    item.message ? t('adminPanel.announcements.message') : null,
  ]
    .filter(Boolean)
    .join(' + ');
  return (
    <li className="space-y-1.5 px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 font-semibold break-words">{item.title}</p>
        {item.level === 'warning' ? (
          <Badge variant="muted">{t('adminPanel.announcements.level.warning')}</Badge>
        ) : null}
        {item.state === 'active' ? <Badge>{t('adminPanel.announcements.active')}</Badge> : null}
      </div>
      <p className="text-sm break-words whitespace-pre-line text-text-muted">{item.body}</p>
      <p className="text-xs text-text-muted">
        {t('adminPanel.announcements.meta', {
          when: date(item.createdAt),
          by: item.createdBy,
          how,
          count: item.recipients,
        })}
        {item.endsAt && item.state === 'active'
          ? ` · ${t('adminPanel.announcements.until', { when: date(item.endsAt) })}`
          : ''}
      </p>
      {item.state === 'active' ? (
        <Button size="sm" variant="danger-outline" onClick={onEnd} className="pointer-coarse:h-11">
          {t('adminPanel.announcements.end')}
        </Button>
      ) : null}
    </li>
  );
}

/** Admin → Announcements: what went out, which banners are up, and a new one. */
export default function AdminAnnouncementsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [ending, setEnding] = useState<AdminAnnouncement | null>(null);
  const list = useInfiniteQuery({
    queryKey: ['admin', 'announcements'],
    queryFn: ({ pageParam }) => announcementsApi.list(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const end = useMutation({
    mutationFn: (reason: string) => announcementsApi.end(ending?.id ?? '', reason),
    onSuccess: () => {
      toast.success(t('admin.saved'));
      void queryClient.invalidateQueries({ queryKey: ['admin', 'announcements'] });
      void queryClient.invalidateQueries({ queryKey: ['announcements'] });
      setEnding(null);
    },
    onError: (error) => toast.error(authErrorMessage(error, t)),
  });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <AdminPage
      title={t('adminPanel.announcements.title')}
      description={t('adminPanel.announcements.subtitle')}
      actions={
        <Button onClick={() => setCreating(true)} className="pointer-coarse:h-11">
          <Plus className="size-4" aria-hidden />
          {t('adminPanel.announcements.new')}
        </Button>
      }
    >
      <div className="max-w-3xl overflow-hidden rounded-2xl border bg-surface shadow-sm">
        {list.isPending ? (
          <div
            role="status"
            aria-busy="true"
            aria-label={t('common.loading')}
            className="space-y-3 p-5"
          >
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : list.isError ? (
          <div role="alert" className="space-y-3 p-5">
            <p className="text-sm">{t('admin.loadFailed')}</p>
            <Button variant="outline" onClick={() => void list.refetch()}>
              {t('adminPanel.dashboard.retry')}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-8 text-center">
            <Megaphone className="size-8 text-text-muted" aria-hidden />
            <p className="text-sm text-text-muted">{t('adminPanel.announcements.empty')}</p>
          </div>
        ) : (
          <ul className="divide-y">
            {items.map((item) => (
              <Row key={item.id} item={item} onEnd={() => setEnding(item)} />
            ))}
          </ul>
        )}
        {list.hasNextPage ? (
          <div className="border-t p-3">
            <Button
              variant="ghost"
              onClick={() => void list.fetchNextPage()}
              disabled={list.isFetchingNextPage}
            >
              {t('common.loadMore')}
            </Button>
          </div>
        ) : null}
      </div>
      {creating ? <NewAnnouncementDialog open onClose={() => setCreating(false)} /> : null}
      <ReasonDialog
        open={ending !== null}
        onClose={() => setEnding(null)}
        title={t('adminPanel.announcements.endTitle', { title: ending?.title ?? '' })}
        description={t('adminPanel.announcements.endBody')}
        confirmLabel={t('adminPanel.announcements.end')}
        danger
        pending={end.isPending}
        onConfirm={(reason) => end.mutate(reason)}
      />
    </AdminPage>
  );
}
