import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import type { TFunction } from 'i18next';
import { Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { buttonVariants } from '@/components/ui/button';
import { AuthCard } from '@/features/auth/components/AuthCard';
import { errorCode } from '@/features/auth/errors';
import { setSignedOut } from '@/features/auth/session';
import { ApiClientError } from '@/lib/api-client';
import { securityApi } from '../api';

/** Reads `#token=…` once and removes it from the address bar and history. */
function takeToken(): string | null {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('token');
  if (window.location.hash) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  return token;
}

function failureMessage(error: unknown, missing: boolean, t: TFunction): string | null {
  if (missing) return t('notMe.missing');
  if (!error) return null;
  const code = errorCode(error);
  if (code === 'SECURITY_TOKEN_EXPIRED') return t('notMe.expired');
  if (code === 'SECURITY_TOKEN_INVALID') return t('notMe.used');
  if (error instanceof ApiClientError && error.isNetworkError) return t('auth.errors.network');
  return t('auth.errors.generic');
}

/** "This wasn't me" from the new-login email: signs the account out on every device. */
export function NotMePage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const started = useRef(false);
  const [missing, setMissing] = useState(false);

  const revoke = useMutation({
    mutationFn: securityApi.notMe,
    onSuccess: () => setSignedOut(queryClient),
  });

  useEffect(() => {
    // Exactly one request, even when effects run twice in development.
    if (started.current) return;
    started.current = true;
    const token = takeToken();
    if (token) revoke.mutate(token);
    else setMissing(true);
  }, [revoke]);

  const failure = failureMessage(revoke.error, missing, t);

  return (
    <>
      {/* The token never leaks through a Referer header from this page. */}
      <meta name="referrer" content="no-referrer" />
      <AuthCard title={t('notMe.title')} subtitle={t('notMe.subtitle')}>
        <div aria-live="polite" className="space-y-4">
          {revoke.isSuccess ? (
            <div className="flex gap-3 rounded-xl bg-success/10 p-4">
              <ShieldCheck className="size-5 shrink-0 text-success" aria-hidden />
              <div className="space-y-1 text-sm">
                <p className="font-semibold">{t('notMe.doneTitle')}</p>
                <p>{t('notMe.done', { count: revoke.data.revokedSessions })}</p>
              </div>
            </div>
          ) : failure ? (
            <div role="alert" className="flex gap-3 rounded-xl bg-danger/10 p-4">
              <ShieldAlert className="size-5 shrink-0 text-danger" aria-hidden />
              <p className="text-sm">{failure}</p>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm text-text-muted">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t('notMe.working')}
            </p>
          )}
          {revoke.isSuccess || failure ? (
            <Link to="/" className={buttonVariants({ className: 'w-full', size: 'lg' })}>
              {t('notMe.signIn')}
            </Link>
          ) : null}
        </div>
      </AuthCard>
    </>
  );
}
