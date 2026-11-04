import { useQuery } from '@tanstack/react-query';
import { healthResponseSchema } from '@zuvo/protocol';
import { useTranslation } from 'react-i18next';
import { apiGet } from '@/lib/api-client';
import { cn } from '@/lib/utils';

export const healthQuery = {
  queryKey: ['health'] as const,
  queryFn: () => apiGet('/v1/health', healthResponseSchema),
  refetchInterval: 30_000,
  retry: 1,
};

/** Small dot showing whether the API is reachable (polls /v1/health). */
export function ConnectionStatus() {
  const { t } = useTranslation();
  const { status } = useQuery(healthQuery);
  const state =
    status === 'success' ? 'connected' : status === 'error' ? 'unreachable' : 'connecting';
  const label = t(`status.${state}`);

  return (
    <span role="status" title={label} className="inline-flex size-8 items-center justify-center">
      <span
        className={cn(
          'size-2.5 rounded-full',
          state === 'connected' && 'bg-accent',
          state === 'connecting' && 'animate-pulse bg-warning',
          state === 'unreachable' && 'bg-danger',
        )}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
