import { useQuery } from '@tanstack/react-query';
import { SESSION_EXPIRY_WARNING_SECONDS } from '@zuvo/protocol';
import { Clock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { sessionQuery } from '../session';
import { useSignOut } from '../use-sign-out';

/** Largest delay setTimeout supports (~24.8 days); longer waits are re-armed. */
const MAX_TIMEOUT = 2_147_483_647;

/**
 * Inside the app: shows the "session ends tomorrow" banner during the last 24 h, and sends the
 * user to the welcome screen when the session expires or the server says it was revoked.
 */
export function SessionGate() {
  const { t } = useTranslation();
  const signOut = useSignOut();
  const { data } = useQuery(sessionQuery);
  const [now, setNow] = useState(Date.now());
  const expiresAt = data?.status === 'signed-in' ? Date.parse(data.data.session.expiresAt) : null;

  // Revoked or expired on the server (seen on refetch/focus).
  useEffect(() => {
    // Only an expired/revoked session gets the "session ended" message; a normal sign-out does not.
    if (data?.status === 'signed-out')
      void signOut(data.reason === 'expired' ? 'expired' : 'signed-out', false);
  }, [data, signOut]);

  // Expiry while the app is open: re-render when the warning starts and at expiry.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `now` re-arms the timer after each tick
  useEffect(() => {
    if (expiresAt === null) return;
    const warnAt = expiresAt - SESSION_EXPIRY_WARNING_SECONDS * 1000;
    const next = Date.now() < warnAt ? warnAt : expiresAt;
    const timer = setTimeout(
      () => setNow(Date.now()),
      Math.min(Math.max(0, next - Date.now()), MAX_TIMEOUT),
    );
    return () => clearTimeout(timer);
  }, [expiresAt, now]);

  useEffect(() => {
    if (expiresAt !== null && now >= expiresAt) void signOut('expired', false);
  }, [expiresAt, now, signOut]);

  if (
    expiresAt === null ||
    expiresAt - now > SESSION_EXPIRY_WARNING_SECONDS * 1000 ||
    now >= expiresAt
  ) {
    return null;
  }
  return (
    <div role="status" className="flex items-center gap-3 border-b bg-warning/10 px-4 py-2 text-sm">
      <Clock className="size-4 shrink-0 text-warning" aria-hidden />
      <p className="min-w-0 flex-1 text-text">{t('auth.expiryWarning')}</p>
      <Button size="sm" variant="outline" onClick={() => void signOut('signed-out')}>
        {t('auth.signInAgain')}
      </Button>
    </div>
  );
}
