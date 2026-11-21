import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AdminGroup } from '@zuvo/protocol';
import { Search, Users } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { authErrorMessage } from '@/features/auth/errors';
import { formatBytes } from '@/lib/format-bytes';
import { useDebouncedValue } from '@/lib/hooks';
import { AdminPage } from '../components/AdminLayout';
import { ReasonDialog } from '../users/ReasonDialog';
import { useWhen } from '../users/UserRows';
import { adminGroupsApi, type GroupFilter } from './api';

type Pending = { kind: 'archive' | 'restore' | 'delete'; group: AdminGroup };

function GroupRow({ group, onAct }: { group: AdminGroup; onAct: (pending: Pending) => void }) {
  const { t, i18n } = useTranslation();
  const when = useWhen();
  return (
    <li className="flex flex-wrap items-start gap-x-4 gap-y-2 px-5 py-4">
      <div className="min-w-0 flex-[1_1_16rem] space-y-1">
        <p className="flex flex-wrap items-center gap-2 font-semibold">
          <span className="min-w-0 break-words">{group.name}</span>
          {group.archived ? <Badge variant="muted">{t('adminPanel.groups.archived')}</Badge> : null}
        </p>
        <p className="text-sm text-text-muted">
          {t('adminPanel.groups.counts', { members: group.memberCount, admins: group.adminCount })}
          {group.owner ? ` · ${t('adminPanel.groups.owner', { name: group.owner.name })}` : ''}
        </p>
        <p className="text-xs text-text-muted">
          {t('adminPanel.groups.meta', {
            created: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium' }).format(
              new Date(group.createdAt),
            ),
            active: when(group.lastActivityAt),
            storage: formatBytes(group.storageBytes, i18n.language),
          })}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => onAct({ kind: group.archived ? 'restore' : 'archive', group })}
          className="pointer-coarse:h-11"
        >
          {t(group.archived ? 'adminPanel.groups.restore' : 'adminPanel.groups.archive')}
        </Button>
        <Button
          size="sm"
          variant="danger-outline"
          onClick={() => onAct({ kind: 'delete', group })}
          className="pointer-coarse:h-11"
        >
          {t('adminPanel.groups.delete')}
        </Button>
      </div>
    </li>
  );
}

/** Admin → Groups: every group without reading it; archive, restore or delete with a reason. */
export default function AdminGroupsPage() {
  const { t } = useTranslation();
  const id = useId();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<GroupFilter>('all');
  const q = useDebouncedValue(search.trim(), 300);
  const [pending, setPending] = useState<Pending | null>(null);
  const [typed, setTyped] = useState('');
  const list = useInfiniteQuery({
    queryKey: ['admin', 'groups', q, filter],
    queryFn: ({ pageParam }) => adminGroupsApi.list(q, filter, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const act = useMutation({
    mutationFn: async (reason: string) => {
      if (!pending) return;
      const groupId = pending.group.id;
      if (pending.kind === 'archive') await adminGroupsApi.archive(groupId, reason);
      else if (pending.kind === 'restore') await adminGroupsApi.restore(groupId, reason);
      else await adminGroupsApi.remove(groupId, typed, reason);
    },
    onSuccess: () => {
      toast.success(t('admin.saved'));
      void queryClient.invalidateQueries({ queryKey: ['admin', 'groups'] });
      setPending(null);
      setTyped('');
    },
    onError: (error) => toast.error(authErrorMessage(error, t)),
  });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const name = pending?.group.name ?? '';
  const nameMatches = typed.trim().toLocaleLowerCase() === name.trim().toLocaleLowerCase();

  return (
    <AdminPage title={t('adminPanel.groups.title')} description={t('adminPanel.groups.subtitle')}>
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-0 flex-[1_1_16rem]">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
            aria-hidden
          />
          <Input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('adminPanel.groups.search')}
            aria-label={t('adminPanel.groups.search')}
            className="pl-9 pointer-coarse:h-11"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-filter`} className="text-xs font-medium text-text-muted">
            {t('adminPanel.users.filterLabel')}
          </label>
          <select
            id={`${id}-filter`}
            value={filter}
            onChange={(event) => setFilter(event.target.value as GroupFilter)}
            className="h-10 rounded-lg border bg-surface px-3 text-sm shadow-sm pointer-coarse:h-11"
          >
            <option value="all">{t('adminPanel.groups.filterAll')}</option>
            <option value="archived">{t('adminPanel.groups.filterArchived')}</option>
          </select>
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border bg-surface shadow-sm">
        {list.isPending ? (
          <div
            role="status"
            aria-busy="true"
            aria-label={t('common.loading')}
            className="space-y-3 p-5"
          >
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
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
            <Users className="size-8 text-text-muted" aria-hidden />
            <p className="text-sm text-text-muted">{t('adminPanel.groups.empty')}</p>
          </div>
        ) : (
          <ul className="divide-y">
            {items.map((group) => (
              <GroupRow key={group.id} group={group} onAct={setPending} />
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
      <ReasonDialog
        key={pending ? `${pending.kind}-${pending.group.id}` : 'closed'}
        open={pending !== null}
        onClose={() => {
          setPending(null);
          setTyped('');
        }}
        title={t(`adminPanel.groups.confirm.${pending?.kind ?? 'archive'}.title`, { name })}
        description={t(`adminPanel.groups.confirm.${pending?.kind ?? 'archive'}.body`, { name })}
        confirmLabel={t(`adminPanel.groups.${pending?.kind ?? 'archive'}`)}
        danger={pending?.kind !== 'restore'}
        pending={act.isPending}
        ready={pending?.kind !== 'delete' || nameMatches}
        onConfirm={(reason) => act.mutate(reason)}
      >
        {pending?.kind === 'delete' ? (
          <div className="space-y-1.5">
            <label htmlFor={`${id}-confirm`} className="block text-sm font-medium">
              {t('adminPanel.groups.typeName', { name })}
            </label>
            <Input
              id={`${id}-confirm`}
              value={typed}
              autoComplete="off"
              onChange={(event) => setTyped(event.target.value)}
              aria-invalid={typed !== '' && !nameMatches}
            />
          </div>
        ) : null}
      </ReasonDialog>
    </AdminPage>
  );
}
