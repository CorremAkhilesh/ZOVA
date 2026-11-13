import { useMutation } from '@tanstack/react-query';
import { OTP_LENGTH } from '@zuvo/protocol';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { OtpInput } from '@/features/auth/components/OtpInput';
import { useSession } from '@/features/auth/session';
import { lockApi } from '../api';
import { lockErrorMessage } from '../errors';
import { formatCountdown, useCooldown } from '../use-countdown';

const RESEND_SECONDS = 60;

/**
 * "Forgot PIN?": a code goes to my email; entering it removes the PIN (and the app lock), and the
 * caller then asks for a new one.
 */
export function ResetPinFlow({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  const email = useSession()?.user.email ?? '';
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const cooldown = useCooldown(RESEND_SECONDS);
  const errorId = useId();
  const request = useMutation({
    mutationFn: () => lockApi.requestReset(),
    onSuccess: () => {
      setSent(true);
      cooldown.start();
    },
  });
  const verify = useMutation({
    mutationFn: (value: string) => lockApi.verifyReset(value),
    onSuccess: onDone,
    onError: () => setCode(''),
  });
  const failed = request.error ?? verify.error;

  if (!sent) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-text-muted">{t('lock.resetHint', { email })}</p>
        {failed ? (
          <p role="alert" className="text-sm text-danger">
            {lockErrorMessage(failed, t)}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button disabled={request.isPending} onClick={() => request.mutate()}>
            {t('lock.sendCode')}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">{t('lock.codeSent', { email })}</p>
      <OtpInput
        value={code}
        onChange={setCode}
        onComplete={(value) => verify.mutate(value)}
        disabled={verify.isPending}
        invalid={verify.isError}
        {...(failed ? { describedBy: errorId } : {})}
      />
      {failed ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          {lockErrorMessage(failed, t)}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          variant="ghost"
          size="sm"
          disabled={cooldown.left > 0 || request.isPending}
          onClick={() => request.mutate()}
        >
          {cooldown.left > 0
            ? t('lock.resendIn', { time: formatCountdown(cooldown.left) })
            : t('lock.resend')}
        </Button>
        <Button
          disabled={code.length !== OTP_LENGTH || verify.isPending}
          onClick={() => verify.mutate(code)}
        >
          {t('lock.verifyCode')}
        </Button>
      </div>
    </div>
  );
}
