import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingsSection } from '@/features/settings/SettingsPage';
import { useQuietHoursSettings } from '../api';
import { QuietHoursForm } from './QuietHoursForm';

/** Settings → Notifications: quiet hours. Loaded on first visit. */
export default function QuietHoursSettings() {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch, dataUpdatedAt } = useQuietHoursSettings();
  if (isPending) {
    return (
      <SettingsSection>
        <div role="status" aria-busy="true" aria-label={t('common.loading')}>
          <Skeleton className="h-10 w-full" />
        </div>
      </SettingsSection>
    );
  }
  if (isError) {
    return (
      <SettingsSection>
        <div role="alert" className="flex items-center gap-3 text-sm text-danger">
          {t('quietHours.loadFailed')}
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      </SettingsSection>
    );
  }
  // A change from another device (or a save) starts the form again from what is saved.
  return <QuietHoursForm key={dataUpdatedAt} saved={data} />;
}
