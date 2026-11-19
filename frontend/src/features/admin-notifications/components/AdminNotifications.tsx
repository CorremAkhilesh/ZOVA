import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { REMIND_USERS_MAX } from '@zuvo/protocol';
import { BellRing, Download } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/features/quiet-hours/components/Switch';
import { SettingsSection } from '@/features/settings/SettingsPage';
import { ADMIN_PUSH_KEY, adminPushApi } from '../api';
import { downloadText, toCsv } from '../csv';
import { PushUserRow } from './PushUserRow';

/** Every page, loaded one after another: the list is small (one organization) and CSV needs all. */
function useAllPeople() {
  const query = useInfiniteQuery({
    queryKey: ADMIN_PUSH_KEY,
    queryFn: ({ pageParam }) => adminPushApi.page(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);
  return query;
}

/**
 * Settings → Admin → Notifications: who gets notified, on which devices (platform, app or browser,
 * push on or off), a filter for those who will miss messages, CSV export, and "Remind".
 */
export function AdminNotifications() {
  const { t, i18n } = useTranslation();
  const people = useAllPeople();
  const [onlyOff, setOnlyOff] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const all = useMemo(() => people.data?.pages.flatMap((page) => page.items) ?? [], [people.data]);
  const shown = onlyOff ? all.filter((row) => !row.pushOn) : all;
  const offCount = all.filter((row) => !row.pushOn).length;
  const date = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );

  const remind = useMutation({
    mutationFn: (userIds: string[]) => adminPushApi.remind(userIds),
    onSuccess: ({ sent }) => {
      toast.success(t('adminPush.reminded', { count: sent }));
      setSelected(new Set());
    },
    onError: () => toast.error(t('adminPush.remindFailed')),
  });
  const choose = (id: string, on: boolean) =>
    setSelected((before) => {
      const next = new Set(before);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const exportCsv = () => {
    const csv = toCsv(shown, {
      header: (t('adminPush.csvHeader', { returnObjects: true }) as string[]) ?? [],
      on: t('adminPush.on'),
      off: t('adminPush.off'),
      app: t('adminPush.app'),
      browser: t('adminPush.browser'),
      unknown: t('adminPush.unknownWhere'),
    });
    downloadText(csv, `notifications-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  if (people.isPending) {
    return (
      <SettingsSection>
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="space-y-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      </SettingsSection>
    );
  }
  if (people.isError) {
    return (
      <SettingsSection>
        <p role="alert" className="text-sm text-danger">
          {t('admin.loadFailed')}
        </p>
      </SettingsSection>
    );
  }

  const picked = [...selected].slice(0, REMIND_USERS_MAX);
  return (
    <SettingsSection>
      <p className="text-sm">{t('adminPush.summary', { count: all.length, off: offCount })}</p>
      <Switch
        label={t('adminPush.onlyOff')}
        hint={t('adminPush.onlyOffHint')}
        checked={onlyOff}
        onChange={setOnlyOff}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => setSelected(new Set(shown.map((row) => row.user.id)))}
          disabled={shown.length === 0}
        >
          {t('adminPush.selectShown')}
        </Button>
        <Button
          onClick={() => remind.mutate(picked)}
          disabled={picked.length === 0 || remind.isPending}
        >
          <BellRing className="size-4" aria-hidden />
          {t('adminPush.remind', { count: picked.length })}
        </Button>
        <Button variant="outline" onClick={exportCsv} disabled={shown.length === 0}>
          <Download className="size-4" aria-hidden />
          {t('adminPush.export')}
        </Button>
      </div>
      {shown.length === 0 ? (
        <p className="text-sm text-text-muted">
          {onlyOff ? t('adminPush.allOn') : t('adminPush.empty')}
        </p>
      ) : (
        <ul className="divide-y" aria-label={t('adminPush.listLabel')}>
          {shown.map((row) => (
            <PushUserRow
              key={row.user.id}
              row={row}
              date={date}
              selected={selected.has(row.user.id)}
              onSelect={(on) => choose(row.user.id, on)}
            />
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}
