import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocalDb } from '@/features/chats/queries';
import { useSyncStore } from './store';
import { useLive } from './use-live';

const LOCK_REFRESH_MS = 2000;

/** Who holds the "one tab sends" lock, across every tab of this browser profile. */
function useLockSummary(): string {
  const [summary, setSummary] = useState('…');
  useEffect(() => {
    async function refresh() {
      if (!navigator.locks) return setSummary('Web Locks not available');
      const { held = [], pending = [] } = await navigator.locks.query();
      const clients = (locks: typeof held) =>
        locks.map((lock) => lock.clientId?.slice(0, 8) ?? '?').join(', ') || 'none';
      setSummary(`held by ${clients(held)}; waiting ${clients(pending)}`);
    }
    void refresh();
    const timer = setInterval(() => void refresh(), LOCK_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);
  return summary;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-text-muted">{label}</dt>
      <dd className="min-w-0 break-words font-mono text-xs">{value}</dd>
    </>
  );
}

/**
 * Development only: what a screenshot needs to show when messages do not move. Never message text.
 * Settings loads this file only in development builds.
 */
export default function DiagnosticsPanel() {
  const { t } = useTranslation();
  const db = useLocalDb();
  const { socket, sync, isLeader, lastHandshakeError, lastProblem } = useSyncStore();
  const locks = useLockSummary();
  const outbox = useLive(() => db?.outbox.toArray() ?? [], [db]);
  const cursor = useLive(async () => (await db?.meta.get('cursor'))?.value ?? 'none', [db]);
  const none = t('diagnostics.none');

  return (
    <details>
      <summary className="cursor-pointer font-medium">{t('diagnostics.title')}</summary>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <Row label={t('diagnostics.socket')} value={socket} />
        <Row label={t('diagnostics.handshakeError')} value={lastHandshakeError ?? none} />
        <Row label={t('diagnostics.lastProblem')} value={lastProblem ?? none} />
        <Row label={t('diagnostics.sync')} value={sync} />
        <Row label={t('diagnostics.cursor')} value={cursor ?? '…'} />
        <Row label={t('diagnostics.thisTabSends')} value={String(isLeader)} />
        <Row label={t('diagnostics.lock')} value={locks} />
        <Row
          label={t('diagnostics.outbox')}
          value={
            outbox?.length
              ? outbox.map((row) => `#${row.n} ${row.state} (${row.attempts})`).join(', ')
              : none
          }
        />
      </dl>
    </details>
  );
}
