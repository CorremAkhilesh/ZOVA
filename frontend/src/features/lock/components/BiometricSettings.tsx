import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { LockStatus } from '@zuvo/protocol';
import { Fingerprint, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { LOCK_KEY, lockApi } from '../api';
import { registerBiometric, useBiometricSupport } from '../biometric';
import { lockErrorMessage } from '../errors';

/** "Unlock with Windows Hello / fingerprint": add this device, or remove them all. */
export function BiometricSettings({ status }: { status: LockStatus }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const supported = useBiometricSupport();
  const [removing, setRemoving] = useState(false);
  const done = (message: string) => () => {
    void queryClient.invalidateQueries({ queryKey: LOCK_KEY });
    toast.success(message);
  };
  const fail = (error: unknown) =>
    toast.error(
      error instanceof Error && error.name === 'NotAllowedError'
        ? t('lock.biometricCancelled')
        : lockErrorMessage(error, t),
    );
  const add = useMutation({
    mutationFn: registerBiometric,
    onSuccess: done(t('lock.biometricAdded')),
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: lockApi.removeBiometric,
    onSuccess: done(t('lock.biometricRemoved')),
    onError: fail,
  });
  if (!status.pinSet) return null;
  const count = status.biometricCount;

  return (
    <div className="space-y-2">
      <p className="font-medium">{t('lock.biometricTitle')}</p>
      <p className="text-sm text-text-muted">
        {count > 0
          ? t('lock.biometricCount', { count })
          : supported
            ? t('lock.biometricHint')
            : t('lock.biometricUnsupported')}
      </p>
      <div className="flex flex-wrap gap-2">
        {supported ? (
          <Button variant="outline" disabled={add.isPending} onClick={() => add.mutate()}>
            <Fingerprint className="size-4" aria-hidden />
            {t('lock.biometricAdd')}
          </Button>
        ) : null}
        {count > 0 ? (
          <Button variant="danger-outline" onClick={() => setRemoving(true)}>
            <Trash2 className="size-4" aria-hidden />
            {t('lock.biometricRemove')}
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={removing}
        onOpenChange={setRemoving}
        title={t('lock.biometricRemoveTitle')}
        description={t('lock.biometricRemoveHint')}
        confirmLabel={t('lock.biometricRemove')}
        danger
        pending={remove.isPending}
        onConfirm={() => {
          remove.mutate();
          setRemoving(false);
        }}
      />
    </div>
  );
}
