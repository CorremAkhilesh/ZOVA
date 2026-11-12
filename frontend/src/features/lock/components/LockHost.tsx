import { lazy, Suspense, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useLockStatus } from '../api';
import { LOCK_LAYER_ATTR, useInertBackground } from '../inert';
import { setAppLockFlag, useLockStore } from '../store';
import { useIdleLock } from '../use-idle-lock';

const AppLockScreen = lazy(() => import('./AppLockScreen'));
const PinSetupDialog = lazy(() =>
  import('./PinSetupDialog').then((module) => ({ default: module.PinSetupDialog })),
);

/** Follows my lock status: locks on start and when idle, and keeps the start-up flag in step. */
function useAppLockRules() {
  const status = useLockStatus().data;
  useEffect(() => {
    if (!status) return;
    const enabled = status.pinSet && status.appLock.enabled;
    setAppLockFlag(enabled);
    const { started, appLocked, lockApp, unlockApp } = useLockStore.getState();
    useLockStore.setState({ pinSet: status.pinSet });
    if (!started) {
      useLockStore.setState({ started: true });
      if (enabled) lockApp();
      else if (appLocked) unlockApp();
      return;
    }
    // The PIN was removed (maybe on another device): nothing can be unlocked with it any more.
    if (!status.pinSet && appLocked) unlockApp();
  }, [status]);
  useIdleLock(status?.pinSet && status.appLock.enabled ? status.appLock.idleMinutes : null);
  // Signed out: the next sign-in checks again, and nothing asked for earlier lingers.
  useEffect(() => () => useLockStore.setState({ started: false, pinSet: null, setup: null }), []);
}

/** Set a PIN, asked for from anywhere (a chat's "Lock chat", "Lock app", a reset by email). */
function SetupHost() {
  const { t } = useTranslation();
  const setup = useLockStore((state) => state.setup);
  if (!setup) return null;
  return (
    <Suspense fallback={null}>
      <PinSetupDialog
        mode="set"
        description={t(setup.reason === 'reset' ? 'lock.resetDone' : 'lock.setHint')}
        onClose={() => useLockStore.getState().closeSetup()}
        onDone={setup.onSet}
      />
    </Suspense>
  );
}

/** The app lock and the set-PIN dialog. Their code loads only when they show. */
export function LockHost() {
  useAppLockRules();
  const locked = useLockStore((state) => state.appLocked);
  useInertBackground(locked);
  return (
    <>
      {locked
        ? createPortal(
            <div
              {...{ [LOCK_LAYER_ATTR]: '' }}
              className="fixed inset-0 z-[3000] overflow-y-auto bg-background"
            >
              <Suspense fallback={null}>
                <AppLockScreen />
              </Suspense>
            </div>,
            document.body,
          )
        : null}
      <SetupHost />
    </>
  );
}
