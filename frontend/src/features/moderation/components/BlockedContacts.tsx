import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingsSection } from '@/features/settings/SettingsPage';
import { blocksQuery, useBlockToggle } from '../blocks';

/** Settings → Privacy → Blocked contacts: who I blocked, newest first, each with Unblock. */
export function BlockedContacts() {
  const { t } = useTranslation();
  const { data, isPending, isError } = useQuery(blocksQuery);
  const toggle = useBlockToggle();
  return (
    <SettingsSection title={t('blocks.title')}>
      <p className="text-sm text-text-muted">{t('blocks.explain')}</p>
      {isPending ? (
        <div role="status" aria-busy="true" aria-label={t('common.loading')}>
          <Skeleton className="h-12 w-full" />
        </div>
      ) : isError ? (
        <p role="alert" className="text-sm text-danger">
          {t('blocks.loadFailed')}
        </p>
      ) : data.length === 0 ? (
        <p className="text-sm text-text-muted">{t('blocks.none')}</p>
      ) : (
        <ul aria-label={t('blocks.title')} className="divide-y">
          {data.map(({ user }) => (
            <li key={user.id} className="flex items-center gap-3 py-2.5">
              <Avatar name={user.displayName} src={user.avatar?.small} className="size-10" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{user.displayName}</span>
                {user.username ? (
                  <span className="block truncate text-sm text-text-muted">@{user.username}</span>
                ) : null}
              </span>
              <Button
                variant="outline"
                size="sm"
                aria-label={t('blocks.unblockName', { name: user.displayName })}
                onClick={() => toggle.mutate({ user, block: false })}
              >
                {t('blocks.unblock')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}
