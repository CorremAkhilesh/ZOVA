import { useMutation } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { brand } from '@zuvo/config';
import { isAllowedEmail, normalizeEmail } from '@zuvo/protocol';
import { Info, Loader2, Lock, TriangleAlert } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authApi } from '../api';
import { authErrorMessage } from '../errors';
import { useAuthFlow } from '../flow-store';
import { AuthCard, FormError } from './AuthCard';

/** Step 1: work email. The domain check here is only for UX — the server enforces it. */
export function EmailStep() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { pendingEmail, codeSent, signedOutReason, setSignedOutReason, wipeIncomplete } =
    useAuthFlow();
  const [email, setEmail] = useState(pendingEmail);
  const [clientError, setClientError] = useState('');
  const domains = [brand.domains.organization];

  const request = useMutation({
    mutationFn: (address: string) => authApi.requestOtp(address),
    onSuccess: (response, address) => {
      codeSent(address, response.resendAfterSeconds);
      setSignedOutReason(null);
      void navigate({ to: '/verify' });
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    const address = normalizeEmail(email);
    if (!isAllowedEmail(address, domains)) {
      setClientError(address.includes('@') ? t('auth.errors.domain') : t('auth.errors.invalid'));
      return;
    }
    setClientError('');
    request.mutate(address);
  }

  const error = clientError || (request.isError ? authErrorMessage(request.error, t) : '');

  return (
    <AuthCard
      title={t('welcome.title', { brand: brand.name })}
      subtitle={t('welcome.subtitle', { tagline: brand.tagline })}
    >
      {signedOutReason === 'expired' ? (
        <p
          role="status"
          className="mb-6 flex items-start gap-2 rounded-xl bg-brand-subtle p-3 text-sm text-brand-text"
        >
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t('auth.sessionEnded')}
        </p>
      ) : null}
      {wipeIncomplete ? (
        <p
          role="alert"
          className="mb-6 flex items-start gap-2 rounded-xl bg-brand-subtle p-3 text-sm font-medium text-danger"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t('auth.wipeIncomplete', { brand: brand.name })}
        </p>
      ) : null}
      <form className="space-y-3" onSubmit={submit} noValidate>
        <label htmlFor="email" className="text-sm font-medium">
          {t('welcome.emailLabel')}
        </label>
        <Input
          id="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoFocus
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder={t('welcome.emailPlaceholder')}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? 'email-error email-hint' : 'email-hint'}
        />
        <p id="email-hint" className="text-xs text-text-muted">
          {t('auth.emailHint')}
        </p>
        {error ? <FormError id="email-error">{error}</FormError> : null}
        <Button type="submit" className="w-full" size="lg" disabled={request.isPending}>
          {request.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {request.isPending ? t('auth.sending') : t('welcome.continue')}
        </Button>
        <p className="flex items-center gap-1.5 text-xs text-text-muted">
          <Lock className="size-3.5" aria-hidden />
          {t('auth.codeExplainer')}
        </p>
      </form>
    </AuthCard>
  );
}
