import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { authApi } from '../api';
import { authErrorMessage, errorCode } from '../errors';
import { useAuthFlow } from '../flow-store';
import { setSignedIn } from '../session';
import { AuthCard, FormError } from './AuthCard';
import { OtpInput } from './OtpInput';

function useSecondsUntil(timestamp: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, Math.ceil((timestamp - now) / 1000));
}

/** Step 2: the 6-digit code. Auto-submits when complete. */
export function OtpStep() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { pendingEmail, resendAvailableAt, codeSent } = useAuthFlow();
  const [code, setCode] = useState('');
  const [failures, setFailures] = useState(0);
  const resendIn = useSecondsUntil(resendAvailableAt);

  const verify = useMutation({
    mutationFn: (value: string) => authApi.verifyOtp(pendingEmail, value),
    onSuccess: (session) => {
      setSignedIn(queryClient, session);
      void navigate({ to: session.needsProfile ? '/welcome/name' : '/chats' });
    },
    onError: () => {
      setCode('');
      setFailures((count) => count + 1);
    },
  });

  const resend = useMutation({
    mutationFn: () => authApi.requestOtp(pendingEmail),
    onSuccess: (response) => {
      codeSent(pendingEmail, response.resendAfterSeconds);
      verify.reset();
      setCode('');
      toast.success(t('auth.codeResent'));
    },
  });

  const failure = verify.error ?? resend.error;
  const message = failure ? authErrorMessage(failure, t) : '';
  const mustResend = ['OTP_ATTEMPTS_EXCEEDED', 'OTP_EXPIRED'].includes(
    errorCode(verify.error) ?? '',
  );

  return (
    <AuthCard
      title={t('auth.codeTitle')}
      subtitle={
        <p>
          {t('auth.codeSentTo')}{' '}
          <span className="font-semibold break-all text-text">{pendingEmail}</span>
        </p>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (code.length === 6) verify.mutate(code);
        }}
      >
        <OtpInput
          // Remount on each failure so the shake animation replays.
          key={failures}
          value={code}
          onChange={setCode}
          onComplete={(value) => verify.mutate(value)}
          disabled={verify.isPending || mustResend}
          invalid={verify.isError}
          {...(message ? { describedBy: 'otp-error' } : {})}
        />
        {message ? <FormError id="otp-error">{message}</FormError> : null}
        <Button
          type="submit"
          className="w-full"
          size="lg"
          disabled={code.length !== 6 || verify.isPending || mustResend}
        >
          {verify.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {verify.isPending ? t('auth.verifying') : t('auth.verify')}
        </Button>
        <div className="flex items-center justify-between text-sm">
          <Link to="/" className="font-medium text-brand-text hover:underline">
            {t('auth.changeEmail')}
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={resendIn > 0 || resend.isPending}
            onClick={() => resend.mutate()}
          >
            {resendIn > 0 ? t('auth.resendIn', { seconds: resendIn }) : t('auth.resend')}
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}
