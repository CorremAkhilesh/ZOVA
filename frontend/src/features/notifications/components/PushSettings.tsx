import { Send } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/features/quiet-hours/components/Switch';
import { SettingsSection } from '@/features/settings/SettingsPage';
import { usePushState } from '../api';
import { useSavePushSettings, useSendTestPush } from '../mutations';
import { NotificationSounds } from './NotificationSounds';
import { PushDevices } from './PushDevices';
import { ThisDevicePush } from './ThisDevicePush';

/** Settings → Notifications: push on this device, preview and sound, a test, and my devices. */
export default function PushSettings() {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = usePushState();
  const save = useSavePushSettings();
  const test = useSendTestPush();

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
          {t('notifications.settings.loadFailed')}
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      </SettingsSection>
    );
  }

  const { settings, publicKey, devices } = data;
  return (
    <>
      <ThisDevicePush publicKey={publicKey} />
      <SettingsSection title={t('notifications.settings.allTitle')}>
        <Switch
          label={t('notifications.settings.preview')}
          hint={t('notifications.settings.previewHint')}
          checked={settings.showPreview}
          onChange={(showPreview) => save.mutate({ showPreview })}
        />
        <Switch
          label={t('notifications.settings.pollVotes')}
          hint={t('notifications.settings.pollVotesHint')}
          checked={settings.pollVotes}
          onChange={(pollVotes) => save.mutate({ pollVotes })}
        />
        {publicKey ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-text-muted">{t('notifications.settings.testHint')}</p>
            <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending}>
              <Send className="size-4" aria-hidden />
              {test.isPending
                ? t('notifications.settings.testSending')
                : t('notifications.settings.test')}
            </Button>
          </div>
        ) : null}
      </SettingsSection>
      <NotificationSounds settings={settings} onSave={(changes) => save.mutate(changes)} />
      <PushDevices devices={devices} />
    </>
  );
}
