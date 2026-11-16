import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSyncStore } from '@/features/sync/store';
import { ConnectionStatus, useConnectionState } from './ConnectionStatus';

/** A sync that finishes sooner shows nothing, so quick catch-ups do not flicker. */
export const UPDATING_DELAY_MS = 300;

function useSlowSync(): boolean {
  const syncing = useSyncStore((state) => state.sync === 'syncing');
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!syncing) {
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), UPDATING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [syncing]);
  return syncing && slow;
}

/**
 * The chat list's status: a quiet "Updating…" while chats stored on the device are being caught
 * up with the server (start-up, reconnects), otherwise the connection pill. Offline and
 * "can't reach server" always win: they explain why nothing is updating.
 */
export function ListStatus() {
  const { t } = useTranslation();
  const connection = useConnectionState();
  const updating = useSlowSync();

  if (!updating || connection === 'offline' || connection === 'unreachable') {
    return <ConnectionStatus />;
  }
  return (
    <span role="status" className="inline-flex items-center gap-1.5 px-1 text-xs text-text-muted">
      <RefreshCw className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />
      {t('status.updating')}
    </span>
  );
}
