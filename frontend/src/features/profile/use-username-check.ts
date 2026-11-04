import { useQuery } from '@tanstack/react-query';
import { normalizeUsername, usernameProblem } from '@zuvo/protocol';
import { useDebouncedValue } from '@/lib/hooks';
import { profileApi } from './api';

export type UsernameStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available' }
  | { state: 'unchanged' }
  | { state: 'problem'; reason: 'too_short' | 'too_long' | 'invalid' | 'reserved' | 'taken' }
  | { state: 'error' };

/**
 * Live username check: the shared rules run instantly in the browser, then a debounced
 * availability request asks the server (rate-limited there). `current` counts as available.
 */
export function useUsernameCheck(input: string, current: string | null = null) {
  const username = normalizeUsername(input);
  const problem = username ? usernameProblem(username) : null;
  const debounced = useDebouncedValue(username, 350);
  const shouldAsk = Boolean(username) && !problem && username !== current;

  const query = useQuery({
    queryKey: ['username-availability', debounced],
    queryFn: () => profileApi.usernameAvailability(debounced),
    enabled: shouldAsk && debounced === username,
    staleTime: 30_000,
    retry: false,
  });

  let status: UsernameStatus;
  if (!username) status = { state: 'idle' };
  else if (problem) status = { state: 'problem', reason: problem };
  else if (username === current) status = { state: 'unchanged' };
  else if (debounced !== username || query.isPending) status = { state: 'checking' };
  else if (query.isError) status = { state: 'error' };
  else if (query.data.available) status = { state: 'available' };
  else status = { state: 'problem', reason: query.data.reason ?? 'taken' };

  return { username, status };
}
