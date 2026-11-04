import { useQuery } from '@tanstack/react-query';
import { healthResponseSchema } from '@zuvo/protocol';
import { useTranslation } from 'react-i18next';
import { Tooltip } from '@/components/ui/tooltip';
import { apiGet } from '@/lib/api-client';
import { useOnlineStatus } from '@/lib/hooks';
import { cn } from '@/lib/utils';

export const healthQuery = {
  queryKey: ['health'] as const,
  queryFn: () => apiGet('/v1/health', healthResponseSchema),
  refetchInterval: 30_000,
  retry: 1,
};

/**
 * - offline: the device has no network (navigator.onLine is false)
 * - unreachable: online, but the API did not answer
 * - connecting: first check or a retry is in flight
 */
export type ConnectionState = 'connected' | 'connecting' | 'unreachable' | 'offline';

export function useConnectionState(): ConnectionState {
  const online = useOnlineStatus();
  const { status, fetchStatus } = useQuery(healthQuery);
  if (!online) return 'offline';
  if (status === 'success') return 'connected';
  if (status === 'pending' || fetchStatus === 'fetching') return 'connecting';
  return 'unreachable';
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
