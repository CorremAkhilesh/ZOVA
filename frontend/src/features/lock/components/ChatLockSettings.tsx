import { useQueryClient } from '@tanstack/react-query';
import type { LockStatus } from '@zuvo/protocol';
import { KeyRound } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingsSection } from '@/features/settings/SettingsPage';
import { LOCK_KEY, useLockStatus } from '../api';
import { useLockStore } from '../store';
import { AppLockSettings } from './AppLockSettings';
import { BiometricSettings } from './BiometricSettings';
import { PinSetupDialog, type PinSetupMode } from './PinSetupDialog';
import { ResetPinFlow } from './ResetPinFlow';

function PinActions({ status }: { status: LockStatus }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<PinSetupMode | null>(null);
  const [forgot, setForgot] = useState(false);
  return (
    <div className="space-y-3">
      <p className="text-sm text-text-muted">
        {t(status.pinSet ? 'lock.pinOnHint' : 'lock.pinOffHint')}
      </p>
      <div className="flex flex-wrap gap-2">
        {status.pinSet ? (
          <>
            <Button variant="outline" onClick={() => setMode('change')}>
              {t('lock.changeTitle')}
            </Button>
            <Button variant="danger-outline" onClick={() => setMode('remove')}>
              {t('lock.removeTitle')}
            </Button>
            <Button variant="ghost" onClick={() => setForgot(true)}>
              {t('lock.forgot')}
            </Button>
          </>
        ) : (
          <Button onClick={() => setMode('set')}>
            <KeyRound className="size-4" aria-hidden />
            {t('lock.setTitle')}
          </Button>
        )}
      </div>
      {mode ? <PinSetupDialog mode={mode} onClose={() => setMode(null)} /> : null}
      <Dialog open={forgot} onOpenChange={setForgot}>
        <DialogContent title={t('lock.resetTitle')}>
          <ResetPinFlow
            onCancel={() => setForgot(false)}
            onDone={() => {
              setForgot(false);
              void queryClient.invalidateQueries({ queryKey: LOCK_KEY });
              useLockStore.getState().requestSetup({ reason: 'reset' });
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Settings → Privacy → Chat lock: the PIN, app lock and Windows Hello / fingerprint. */
export default function ChatLockSettings() {
  const { t } = useTranslation();
  const { data, isPending, isError, refetch } = useLockStatus();
  return (
    <SettingsSection title={t('lock.settingsTitle')}>
      <div id="chat-lock" className="space-y-5">
        {isPending ? (
          <div role="status" aria-busy="true" aria-label={t('lock.loading')}>
            <Skeleton className="h-10 w-full" />
          </div>
        ) : isError ? (
          <div role="alert" className="flex items-center gap-3">
            <p className="flex-1 text-sm text-danger">{t('lock.loadFailed')}</p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              {t('errors.retry')}
            </Button>
          </div>
        ) : (
          <>
            <PinActions status={data} />
            <AppLockSettings status={data} />
            <BiometricSettings status={data} />
          </>
        )}
      </div>
    </SettingsSection>
  );
}
