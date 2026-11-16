import type { PushDevice } from '@zuvo/protocol';
import { Bell } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SettingsSection } from '@/features/settings/SettingsPage';
import { formatRelativeTime } from '@/lib/relative-time';
import { useRemovePushDevice } from '../mutations';

/** Settings → Notifications → My devices with notifications. */
export function PushDevices({ devices }: { devices: PushDevice[] }) {
  const { t, i18n } = useTranslation();
  const remove = useRemovePushDevice();
  const when = (iso: string) => formatRelativeTime(iso, i18n.language);
  return (
    <SettingsSection title={t('notifications.settings.devicesTitle')}>
      {devices.length === 0 ? (
        <p className="text-sm text-text-muted">{t('notifications.settings.devicesEmpty')}</p>
      ) : (
        <ul className="divide-y">
          {devices.map((device) => (
            <li key={device.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <span className="mt-0.5 rounded-lg bg-brand-subtle p-2 text-brand-text">
                <Bell className="size-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {device.label}
                  {device.current ? (
                    <Badge variant="accent">{t('notifications.settings.thisDevice')}</Badge>
                  ) : null}
                </p>
                <p className="text-sm text-text-muted">
                  {device.lastUsedAt
                    ? t('notifications.settings.lastUsed', { when: when(device.lastUsedAt) })
                    : t('notifications.settings.added', { when: when(device.createdAt) })}
                </p>
              </div>
              {device.current ? null : (
                <Button
                  variant="danger-outline"
                  size="sm"
                  disabled={remove.isPending && remove.variables === device.id}
                  onClick={() => remove.mutate(device.id)}
                  aria-label={t('notifications.settings.removeLabel', { name: device.label })}
                >
                  {t('notifications.settings.remove')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}
