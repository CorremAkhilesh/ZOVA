import { brand } from '@zuvo/config';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Switch } from '@/features/quiet-hours/components/Switch';
import { SettingsSection } from '@/features/settings/SettingsPage';
import { isPushProblem as isProblem, usePushStatus, usePushToggle } from '../status';
import { usePermission } from '../support';
import { PermissionHelp } from './PermissionHelp';

/** Settings → Notifications → This device: push on or off here, and why it may not work. */
export function ThisDevicePush({ publicKey }: { publicKey: string | null }) {
  const { t } = useTranslation();
  const status = usePushStatus();
  const permission = usePermission();
  const toggle = usePushToggle();
  const [busy, setBusy] = useState(false);
  if (!status) return null;

  const change = async (on: boolean) => {
    if (!publicKey) return;
    setBusy(true);
    const result = await toggle(on, publicKey);
    setBusy(false);
    if (result === 'on') toast.success(t('notifications.enabled'));
    else if (result === 'failed') toast.error(t('notifications.failed'));
  };
  const blocked = status === 'server-off' || isProblem(status);

  return (
    <SettingsSection title={t('notifications.settings.deviceTitle')}>
      <Switch
        label={t('notifications.settings.push')}
        hint={t('notifications.settings.pushHint', { brand: brand.name })}
        checked={status === 'on'}
        disabled={busy || blocked}
        onChange={(on) => void change(on)}
      />
      {status === 'server-off' ? (
        <p className="text-sm text-text-muted">{t('notifications.settings.serverOff')}</p>
      ) : (
        <p className="text-sm text-text-muted">
          {t(`notifications.settings.permission.${permission}`)}
        </p>
      )}
      {isProblem(status) ? (
        <div role="note" className="rounded-xl bg-background p-3">
          <PermissionHelp problem={status} />
        </div>
      ) : null}
    </SettingsSection>
  );
}
