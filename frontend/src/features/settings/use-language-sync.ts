import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { type SessionState, sessionQuery } from '@/features/auth/session';
import { profileApi } from '@/features/profile/api';
import { applyProfile } from '@/features/profile/queries';
import { i18n } from '@/lib/i18n';
import { nextLanguageStep, shownLanguage, usePendingLanguage } from './language-sync';

/**
 * The session as the cache holds it, without observing the query: an observer would change when
 * it is fetched (a disabled one even stops refetches), and this must never fetch by itself.
 */
function useCachedSession() {
  const queryClient = useQueryClient();
  const subscribe = useCallback(
    (onChange: () => void) => queryClient.getQueryCache().subscribe(onChange),
    [queryClient],
  );
  return useSyncExternalStore(subscribe, () =>
    queryClient.getQueryData<SessionState>(sessionQuery.queryKey),
  );
}

/**
 * Keeps the app's language and the profile's in step: applies the saved one at start-up, on
 * sign-in and whenever the session is refreshed (another device changed it), and saves a choice
 * made here.
 */
export function useLanguageSync() {
  const queryClient = useQueryClient();
  const data = useCachedSession();
  const pending = usePendingLanguage((state) => state.pending);
  const session = data?.status === 'signed-in' && !data.offline ? data.data : null;
  const userId = session?.user.id;
  const saved = session?.user.language;
  const needsProfile = session?.needsProfile;

  useEffect(() => {
    if (!userId || !saved) return;
    if (pending?.userId === userId && pending.language === saved) {
      usePendingLanguage.getState().setPending(null);
      return;
    }
    const step = nextLanguageStep(
      { userId, saved, needsProfile: needsProfile ?? false },
      shownLanguage(),
      pending,
    );
    if (step.kind === 'apply') void i18n.changeLanguage(step.language);
    if (step.kind !== 'save') return;
    let cancelled = false;
    profileApi
      .update({ language: step.language })
      .then(({ profile }) => {
        if (cancelled) return;
        // The session now says the same: the pending choice is cleared on the next run.
        applyProfile(queryClient, profile);
      })
      .catch(() => {
        // Offline or refused: the choice stays pending and is tried again next time.
      });
    return () => {
      cancelled = true;
    };
  }, [userId, saved, needsProfile, pending, queryClient]);
}
