import { useQuery } from '@tanstack/react-query';
import { mediaApi } from './api';

/** Settings the server decides. Undefined while offline: the server still has the last word. */
export function useAppConfig({ enabled = true }: { enabled?: boolean } = {}) {
  const { data } = useQuery({
    queryKey: ['config'],
    queryFn: mediaApi.config,
    staleTime: 5 * 60_000,
    enabled,
  });
  return data;
}
