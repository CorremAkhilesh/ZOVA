import type { AdminPushDevice, AdminPushUser } from '@zuvo/protocol';
import { Laptop, Smartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

const PHONES = new Set(['android', 'iphone']);

function DeviceLine({ device, date }: { device: AdminPushDevice; date: (iso: string) => string }) {
  const { t } = useTranslation();
  const Icon = PHONES.has(device.platform) ? Smartphone : Laptop;
  const where =
    device.installed === null
      ? t('adminPush.unknownWhere')
      : device.installed
        ? t('adminPush.app')
        : t('adminPush.browser');
  return (
    <li className="flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
      <Icon className="size-3.5" aria-hidden />
      <span className="text-text">{t(`adminPush.platforms.${device.platform}`)}</span>
      <span>· {device.label}</span>
      <span>· {where}</span>
      <span className={device.pushOn ? 'text-success' : 'text-danger'}>
        · {device.pushOn ? t('adminPush.pushOn') : t('adminPush.pushOff')}
      </span>
      {device.permission === 'denied' ? <span>· {t('adminPush.blocked')}</span> : null}
      <span>· {t('adminPush.active', { when: date(device.lastActiveAt) })}</span>
    </li>
  );
}

/** One person: a checkbox (to remind them), on/off, each device, and when they were last seen. */
export function PushUserRow(props: {
  row: AdminPushUser;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  date: (iso: string) => string;
}) {
  const { t } = useTranslation();
  const { row, date } = props;
  const name = row.user.displayName ?? row.user.email;
  return (
    <li className="flex items-start gap-3 py-3">
      {/* The label is the 44 px touch target; the box stays small to look at. */}
      <label className="tap-target mt-0.5 flex size-6 shrink-0 items-center justify-center">
        <input
          type="checkbox"
          className="size-4 accent-brand"
          aria-label={t('adminPush.select', { name })}
          checked={props.selected}
          onChange={(event) => props.onSelect(event.target.checked)}
        />
      </label>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 font-medium break-all">{name}</span>
          <span className="min-w-0 text-xs break-all text-text-muted">{row.user.email}</span>
          <span
            className={cn(
              'rounded-full px-2 py-0.5 font-medium text-xs',
              row.pushOn
                ? 'border border-success text-success'
                : 'border border-danger text-danger',
            )}
          >
            {row.pushOn ? t('adminPush.on') : t('adminPush.off')}
          </span>
        </div>
        {row.devices.length === 0 ? (
          <p className="text-xs text-text-muted">{t('adminPush.noDevices')}</p>
        ) : (
          <ul className="space-y-0.5" aria-label={t('adminPush.devicesOf', { name })}>
            {row.devices.map((device) => (
              <DeviceLine key={device.id} device={device} date={date} />
            ))}
          </ul>
        )}
        <p className="text-xs text-text-muted">
          {row.lastSeenAt
            ? t('adminPush.lastSeen', { when: date(row.lastSeenAt) })
            : t('adminPush.neverSeen')}
        </p>
      </div>
    </li>
  );
}
