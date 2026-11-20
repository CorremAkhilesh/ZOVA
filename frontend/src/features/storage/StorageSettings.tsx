import { useQuery } from '@tanstack/react-query';
import type { StorageUsage } from '@zuvo/protocol';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { formatBytes } from '@/features/media/process';
import { SettingsSection } from '@/features/settings/SettingsPage';
import { cn } from '@/lib/utils';
import { storageApi, storageLevel, storageQueryKey, takenBytes } from './api';

const KINDS = ['image', 'video', 'voice', 'audio', 'document'] as const;

function Meter({ usage }: { usage: StorageUsage }) {
  const { t, i18n } = useTranslation();
  const size = (bytes: number) => formatBytes(bytes, i18n.language);
  const level = storageLevel(usage);
  const percent = Math.min(100, Math.round((takenBytes(usage) / usage.quotaBytes) * 100));
  return (
    <div className="space-y-2">
      <p className="text-2xl font-semibold tracking-tight">
        {t('storage.usedOf', { used: size(takenBytes(usage)), limit: size(usage.quotaBytes) })}
      </p>
      {/* biome-ignore lint/a11y/useSemanticElements: a styled bar; <meter> cannot be themed alike in every browser */}
      <div
        role="meter"
        aria-label={t('storage.meterLabel')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={t('storage.percentUsed', { percent })}
        className="h-3 overflow-hidden rounded-full bg-background"
      >
        <div
          className={cn(
            'h-full rounded-full transition-[width]',
            level === 'ok' ? 'bg-brand' : 'bg-danger',
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-sm text-text-muted">
        {t('storage.free', { size: size(Math.max(0, usage.quotaBytes - takenBytes(usage))) })}
        {usage.pendingBytes > 0
          ? ` · ${t('storage.uploading', { size: size(usage.pendingBytes) })}`
          : ''}
      </p>
    </div>
  );
}

/** Settings → Storage: how much of my limit my files use, by kind, and what to do when it is full. */
export function StorageSettings() {
  const { t, i18n } = useTranslation();
  const usage = useQuery({ queryKey: storageQueryKey, queryFn: storageApi.mine });

  if (usage.isPending) {
    return (
      <SettingsSection>
        <div role="status" aria-busy="true" aria-label={t('common.loading')} className="space-y-3">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      </SettingsSection>
    );
  }
  if (usage.isError) {
    return (
      <SettingsSection>
        <p role="alert" className="text-sm text-danger">
          {t('storage.loadFailed')}
        </p>
        <Button variant="outline" onClick={() => void usage.refetch()}>
          {t('common.retry')}
        </Button>
      </SettingsSection>
    );
  }

  const level = storageLevel(usage.data);
  return (
    <>
      <SettingsSection>
        <Meter usage={usage.data} />
        {level === 'ok' ? null : (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-xl bg-danger/10 p-3 text-sm text-danger"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t(level === 'full' ? 'storage.fullHint' : 'storage.nearlyFullHint')}
          </p>
        )}
      </SettingsSection>
      <SettingsSection title={t('storage.byKind')}>
        {usage.data.usedBytes === 0 ? (
          <p className="text-sm text-text-muted">{t('storage.empty')}</p>
        ) : (
          <dl className="divide-y">
            {KINDS.map((kind) => (
              <div key={kind} className="flex items-center justify-between py-2.5 text-sm">
                <dt>{t(`storage.kinds.${kind}`)}</dt>
                <dd className="font-medium tabular-nums">
                  {formatBytes(usage.data.byKind[kind], i18n.language)}
                </dd>
              </div>
            ))}
          </dl>
        )}
        <p className="text-sm text-text-muted">{t('storage.howToFree')}</p>
      </SettingsSection>
    </>
  );
}
