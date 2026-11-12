import { toast } from 'sonner';
import { lockApi } from './api';
import { useLockStore } from './store';

interface LockAppContext {
  go: (to: '/settings/privacy') => void;
  t: (key: string) => string;
}

/** "Lock app": locks at once. Without a PIN, Settings → Privacy asks for one first. */
export async function lockAppNow({ go, t }: LockAppContext) {
  const known = useLockStore.getState().pinSet;
  const pinSet = known ?? (await lockApi.status()).lock.pinSet;
  if (pinSet) {
    useLockStore.getState().lockApp();
    return;
  }
  go('/settings/privacy');
  toast(t('lock.setPinFirst'));
  useLockStore.getState().requestSetup({ reason: 'new' });
}
