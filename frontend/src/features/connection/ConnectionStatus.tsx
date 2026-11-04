import { useTranslation } from 'react-i18next';
import { Tooltip } from '@/components/ui/tooltip';
import { useSyncStore } from '@/features/sync/store';
import { useOnlineStatus } from '@/lib/hooks';
import { cn } from '@/lib/utils';

/**
 * - offline: the device has no network (navigator.onLine is false)
 * - unreachable: online, but the socket keeps failing to connect
 * - connecting: the first attempt, or reconnecting after the socket dropped
 */
export type ConnectionState = 'connected' | 'connecting' | 'unreachable' | 'offline';

export function useConnectionState(): ConnectionState {
  const online = useOnlineStatus();
  const socket = useSyncStore((state) => state.socket);
  return online ? socket : 'offline';
}

const PILL: Record<
  Exclude<ConnectionState, 'connected'>,
  { label: string; hint: string; amber: boolean }
> = {
  connecting: { label: 'status.connecting', hint: 'status.connectingHint', amber: true },
  unreachable: { label: 'status.unreachableShort', hint: 'status.unreachableHint', amber: false },
  offline: { label: 'status.offlineShort', hint: 'status.offlineHint', amber: false },
};

/** Silent when connected; otherwise a small amber or red pill with an explanatory tooltip. */
export function ConnectionStatus() {
  const { t } = useTranslation();
  const state = useConnectionState();

  if (state === 'connected') {
    // Keep a live region so screen readers hear when the connection comes back.
    return (
      <span role="status" className="sr-only">
        {t('status.connected')}
      </span>
    );
  }

  const pill = PILL[state];
  return (
    <Tooltip label={t(pill.hint)} side="bottom">
      {/* A button so keyboard users can focus it and get the tooltip. */}
      <button
        type="button"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
          pill.amber ? 'border-warning text-warning' : 'border-danger text-danger',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'size-1.5 rounded-full',
            pill.amber ? 'animate-pulse bg-warning' : 'bg-danger',
          )}
        />
        <span role="status">{t(pill.label)}</span>
      </button>
    </Tooltip>
  );
}
