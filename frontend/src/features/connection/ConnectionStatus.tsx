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

export type ConnectionState = 'connected' | 'connecting' | 'offline';

export function useConnectionState(): ConnectionState {
  const online = useOnlineStatus();
  const { status } = useQuery(healthQuery);
  if (!online || status === 'error') return 'offline';
  return status === 'success' ? 'connected' : 'connecting';
}

/**
 * Silent when connected. Otherwise a small amber "Connecting…" or red "Offline" pill with a
 * tooltip explaining what it means.
 */
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

  const connecting = state === 'connecting';
  return (
    <Tooltip label={t(connecting ? 'status.connectingHint' : 'status.offlineHint')} side="bottom">
      {/* A button so keyboard users can focus it and get the tooltip. */}
      <button
        type="button"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
          connecting ? 'border-warning text-warning' : 'border-danger text-danger',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'size-1.5 rounded-full',
            connecting ? 'animate-pulse bg-warning' : 'bg-danger',
          )}
        />
        <span role="status">{t(connecting ? 'status.connecting' : 'status.offlineShort')}</span>
      </button>
    </Tooltip>
  );
}
