import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Fingerprint } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { errorCode } from '@/features/auth/errors';
import { LOCK_KEY, lockApi, useLockStatus } from '../api';
import { unlockWithBiometric, useBiometricSupport } from '../biometric';
import { lockErrorMessage, type PinFailure, pinFailure } from '../errors';
import { useLockStore } from '../store';
import { PinPad } from './PinPad';
import { ResetPinFlow } from './ResetPinFlow';

const future = (until: string | null | undefined) =>
  until && Date.parse(until) > Date.now() ? until : null;

/**
 * Asks for my PIN (or Windows Hello / a fingerprint where this device has one) before showing
 * what is locked. "Forgot PIN?" resets it by email, then asks for a new one.
 */
export function PinPrompt({ label, onUnlocked }: { label: string; onUnlocked: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const status = useLockStatus().data;
  const supported = useBiometricSupport();
  const [failure, setFailure] = useState<PinFailure | null>(null);
  const [forgot, setForgot] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: LOCK_KEY });

  const verify = useMutation({
    mutationFn: (pin: string) => lockApi.verify(pin),
    onSuccess: () => {
      setFailure(null);
      refresh();
      onUnlocked();
    },
    onError: (error) => {
      refresh();
      // Removed on another device meanwhile: nothing is locked any more.
      if (errorCode(error) === 'PIN_NOT_SET') onUnlocked();
      else setFailure(pinFailure(error, t));
    },
  });
  const biometric = useMutation({
    mutationFn: unlockWithBiometric,
    onSuccess: onUnlocked,
  });

  if (forgot) {
    return (
      <ResetPinFlow
        onCancel={() => setForgot(false)}
        onDone={() => {
          refresh();
          onUnlocked();
          useLockStore.getState().requestSetup({ reason: 'reset' });
        }}
      />
    );
  }

  const lockedUntil = future(failure?.lockedUntil) ?? future(status?.lockedUntil);
  return (
    <div className="flex flex-col items-center gap-3">
      <PinPad
        label={label}
        submitLabel={t('lock.unlock')}
        onSubmit={(pin) => verify.mutate(pin)}
        error={failure?.message}
        lockedUntil={lockedUntil}
        onLockoutEnd={() => {
          setFailure(null);
          refresh();
        }}
        busy={verify.isPending}
      />
      {supported && (status?.biometricCount ?? 0) > 0 ? (
        <Button variant="outline" disabled={biometric.isPending} onClick={() => biometric.mutate()}>
          <Fingerprint className="size-4" aria-hidden />
          {t('lock.useBiometric')}
        </Button>
      ) : null}
      {biometric.isError ? (
        <p role="alert" className="text-sm text-danger">
          {biometric.error instanceof Error && biometric.error.name === 'NotAllowedError'
            ? t('lock.biometricCancelled')
            : lockErrorMessage(biometric.error, t)}
        </p>
      ) : null}
      <Button variant="ghost" size="sm" onClick={() => setForgot(true)}>
        {t('lock.forgot')}
      </Button>
    </div>
  );
}
