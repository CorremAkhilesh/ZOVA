import type { PushClientReport } from '@zuvo/protocol';
import { useEffect, useRef } from 'react';
import { isStandalone } from '@/features/install/detect';
import { pushApi } from './api';
import { usePushPrefs } from './prefs';
import type { PushStatus } from './status';
import { readPermission } from './support';

/** What this device reports, from its push status (undefined: still loading, nothing to say). */
export function clientReport(
  status: PushStatus | undefined,
  enabled: boolean,
): PushClientReport | null {
  if (!status || status === 'server-off') return null;
  const permission = readPermission();
  return {
    permission: status === 'ios-install' ? 'unsupported' : permission,
    installed: isStandalone(window),
    enabled,
  };
}

/** Tells the server (once per change) so Admin → Notifications shows who will miss messages. */
export function useReportPushClient(status: PushStatus | undefined): void {
  const enabled = usePushPrefs((state) => state.enabled);
  const lastSent = useRef('');
  useEffect(() => {
    const report = clientReport(status, enabled);
    if (!report) return;
    const key = JSON.stringify(report);
    if (key === lastSent.current) return;
    lastSent.current = key;
    pushApi.client(report).catch(() => {
      lastSent.current = '';
    });
  }, [enabled, status]);
}
