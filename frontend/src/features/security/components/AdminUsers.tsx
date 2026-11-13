import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { AdminUser, AdminUserRow } from '@zuvo/protocol';
import { Search } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { authErrorMessage } from '@/features/auth/errors';
import { useSession } from '@/features/auth/session';
import { formatBytes } from '@/features/media/process';
import { SettingsSection } from '@/features/settings/SettingsPage';
import { useDebouncedValue } from '@/lib/hooks';
import { adminApi } from '../api';

type Action = { user: AdminUser; kind: 'deactivate' | 'reactivate' | 'promote' | 'demote' };

function UserRow({
  user,
  self,
  onAction,
}: {
  user: AdminUserRow;
  self: boolean;
  onAction: (action: Action) => void;
}) {
  const { t, i18n } = useTranslation();
  const deactivated = user.status === 'deactivated';
  const admin = user.role === 'admin';
  return (
    <li className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {user.displayName ?? user.email}
          {admin ? <Badge>{t('admin.roleAdmin')}</Badge> : null}
          {deactivated ? <Badge variant="muted">{t('admin.deactivated')}</Badge> : null}
        </p>
        <p className="truncate text-sm text-text-muted">
          {user.email}
          {user.username ? ` · @${user.username}` : ''}
        </p>
        <p className="text-xs text-text-muted">
          {t('admin.storageUsed', { size: formatBytes(user.storageBytes, i18n.language) })}
        </p>
      </div>
      {self ? (
        <span className="text-xs text-text-muted">{t('admin.you')}</span>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAction({ user, kind: admin ? 'demote' : 'promote' })}
          >
            {admin ? t('admin.demote') : t('admin.promote')}
          </Button>
          <Button
            size="sm"
            variant={deactivated ? 'outline' : 'danger-outline'}
            onClick={() => onAction({ user, kind: deactivated ? 'reactivate' : 'deactivate' })}
          >
            {deactivated ? t('admin.reactivate') : t('admin.deactivate')}
          </Button>
        </div>
      )}
    </li>
  );
}

/** Admin → Users: search, deactivate/reactivate and promote/demote, each with a confirmation. */
export function AdminUsers() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const me = useSession()?.user;
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search.trim(), 300);
  const [action, setAction] = useState<Action | null>(null);

  const users = useInfiniteQuery({
    queryKey: ['admin', 'users', q],
    queryFn: ({ pageParam }) => adminApi.users(q, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

  const run = useMutation({
    mutationFn: async ({ user, kind }: Action) => {
      if (kind === 'deactivate' || kind === 'reactivate') await adminApi.setStatus(user.id, kind);
      else await adminApi.setRole(user.id, kind === 'promote' ? 'admin' : 'user');
    },
    onSuccess: () => {
      setAction(null);
      toast.success(t('admin.saved'));
      void queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
    onError: (error) => {
      setAction(null);
      toast.error(authErrorMessage(error, t));
    },
  });

  const items = users.data?.pages.flatMap((page) => page.items) ?? [];
  const name = action ? (action.user.displayName ?? action.user.email) : '';

  return (
    <>
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
          aria-hidden
        />
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('admin.searchUsers')}
          aria-label={t('admin.searchUsers')}
          className="pl-9"
        />
      </div>
      <SettingsSection>
        {users.isPending ? (
          <div
            role="status"
            aria-busy="true"
            aria-label={t('common.loading')}
            className="space-y-3"
          >
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : users.isError ? (
          <p role="alert" className="text-sm text-danger">
            {t('admin.loadFailed')}
          </p>
        ) : items.length === 0 ? (
          <p className="text-sm text-text-muted">{t('admin.noUsers')}</p>
        ) : (
          <ul className="divide-y">
            {items.map((user) => (
              <UserRow key={user.id} user={user} self={user.id === me?.id} onAction={setAction} />
            ))}
          </ul>
        )}
        {users.hasNextPage ? (
          <Button
            variant="ghost"
            onClick={() => void users.fetchNextPage()}
            disabled={users.isFetchingNextPage}
          >
            {t('common.loadMore')}
          </Button>
        ) : null}
      </SettingsSection>
      <ConfirmDialog
        open={action !== null}
        onOpenChange={(open) => (open ? null : setAction(null))}
        title={action ? t(`admin.confirm.${action.kind}.title`, { name }) : ''}
        description={action ? t(`admin.confirm.${action.kind}.body`, { name }) : ''}
        confirmLabel={action ? t(`admin.${action.kind}`) : ''}
        onConfirm={() => action && run.mutate(action)}
        pending={run.isPending}
        danger={action?.kind === 'deactivate' || action?.kind === 'demote'}
      />
    </>
  );
}
