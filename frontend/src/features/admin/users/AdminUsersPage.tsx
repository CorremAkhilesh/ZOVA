import { useInfiniteQuery } from '@tanstack/react-query';
import type { AdminUserRow } from '@zuvo/protocol';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { authErrorMessage } from '@/features/auth/errors';
import { useSession } from '@/features/auth/session';
import { useAppConfig } from '@/features/media/use-app-config';
import { useDebouncedValue } from '@/lib/hooks';
import { AdminPage } from '../components/AdminLayout';
import { adminUsersApi, downloadUsersCsv, type UserFilter, type UserSort, usersKey } from './api';
import {
  BULK_KINDS,
  type PendingAction,
  UserActionDialog,
  type UserActionKind,
} from './UserActionDialog';
import { nameOf, UserRowItem } from './UserRows';
import { UsersToolbar } from './UsersToolbar';

const GB = 1024 ** 3;

/** Admin → Users: find people, act on one (their page) or many (select, then a bulk action). */
export default function AdminUsersPage() {
  const { t } = useTranslation();
  const me = useSession()?.user;
  const defaultGb = Math.round((useAppConfig()?.media.userQuotaBytes ?? 3 * GB) / GB);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<UserFilter>('all');
  const [sort, setSort] = useState<UserSort>('newest');
  const q = useDebouncedValue(search.trim(), 300);
  const params = { q, filter, sort };
  const [selected, setSelected] = useState<Map<string, AdminUserRow>>(new Map());
  const [action, setAction] = useState<PendingAction | null>(null);
  const [exporting, setExporting] = useState(false);

  const users = useInfiniteQuery({
    queryKey: usersKey(params),
    queryFn: ({ pageParam }) => adminUsersApi.list(params, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const items = users.data?.pages.flatMap((page) => page.items) ?? [];
  const selectable = items.filter((user) => user.id !== me?.id);
  const allSelected = selectable.length > 0 && selectable.every((user) => selected.has(user.id));

  const select = (user: AdminUserRow, on: boolean) =>
    setSelected((current) => {
      const next = new Map(current);
      if (on) next.set(user.id, user);
      else next.delete(user.id);
      return next;
    });
  const selectAll = (on: boolean) =>
    setSelected(on ? new Map(selectable.map((user) => [user.id, user])) : new Map());
  const bulk = (kind: UserActionKind) =>
    setAction({
      kind,
      people: [...selected.values()].map((user) => ({ id: user.id, name: nameOf(user) })),
    });

  async function exportCsv() {
    setExporting(true);
    try {
      await downloadUsersCsv(params);
    } catch (error) {
      toast.error(authErrorMessage(error, t));
    } finally {
      setExporting(false);
    }
  }

  return (
    <AdminPage title={t('admin.usersTitle')} description={t('adminPanel.users.subtitle')}>
      <UsersToolbar
        search={search}
        onSearch={setSearch}
        filter={filter}
        onFilter={(value) => {
          setFilter(value);
          setSelected(new Map());
        }}
        sort={sort}
        onSort={setSort}
        onExport={() => void exportCsv()}
        exporting={exporting}
      />
      {selected.size > 0 ? (
        <section
          aria-label={t('adminPanel.users.bulkLabel')}
          className="flex flex-wrap items-center gap-2 rounded-2xl border bg-brand-subtle/60 p-3"
        >
          <p className="mr-auto text-sm font-medium" aria-live="polite">
            {t('adminPanel.users.selected', { count: selected.size })}
          </p>
          {BULK_KINDS.map((kind) => (
            <Button
              key={kind}
              size="sm"
              variant={kind === 'deactivate' ? 'danger-outline' : 'outline'}
              onClick={() => bulk(kind)}
              className="pointer-coarse:h-11"
            >
              {t(`adminPanel.users.actions.${kind}.confirm`)}
            </Button>
          ))}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setSelected(new Map())}
            className="pointer-coarse:h-11"
          >
            {t('adminPanel.users.clearSelection')}
          </Button>
        </section>
      ) : null}
      <div className="overflow-hidden rounded-2xl border bg-surface shadow-sm">
        <div className="flex items-center gap-3 border-b px-4 py-2 text-xs font-medium text-text-muted">
          <label className="tap-target flex size-6 items-center justify-center">
            <input
              type="checkbox"
              checked={allSelected}
              disabled={selectable.length === 0}
              onChange={(event) => selectAll(event.target.checked)}
              aria-label={t('adminPanel.users.selectAll')}
              className="size-4 accent-[var(--color-brand)]"
            />
          </label>
          <span>{t('adminPanel.users.count', { count: items.length })}</span>
        </div>
        {users.isPending ? (
          <div
            role="status"
            aria-busy="true"
            aria-label={t('common.loading')}
            className="space-y-3 p-4"
          >
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : users.isError ? (
          <div role="alert" className="space-y-3 p-4">
            <p className="text-sm text-danger">{t('admin.loadFailed')}</p>
            <Button variant="outline" onClick={() => void users.refetch()}>
              {t('adminPanel.dashboard.retry')}
            </Button>
          </div>
        ) : items.length === 0 ? (
          <p className="p-4 text-sm text-text-muted">{t('admin.noUsers')}</p>
        ) : (
          <ul className="divide-y">
            {items.map((user) => (
              <UserRowItem
                key={user.id}
                user={user}
                self={user.id === me?.id}
                selected={selected.has(user.id)}
                onSelect={(on) => select(user, on)}
              />
            ))}
          </ul>
        )}
        {users.hasNextPage ? (
          <div className="border-t p-3">
            <Button
              variant="ghost"
              onClick={() => void users.fetchNextPage()}
              disabled={users.isFetchingNextPage}
            >
              {t('common.loadMore')}
            </Button>
          </div>
        ) : null}
      </div>
      <UserActionDialog
        action={action}
        defaultGb={defaultGb}
        onClose={() => setAction(null)}
        onDone={() => setSelected(new Map())}
      />
    </AdminPage>
  );
}
