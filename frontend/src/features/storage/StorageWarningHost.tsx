import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { formatBytes } from '@/features/media/process';
import { onStorageChanged, storageApi, storageLevel, storageQueryKey, takenBytes } from './api';

const SHOWN_KEY = 'zuvo.storageWarningShown';
const DAY_MS = 24 * 3600_000;

/** Once a day at most: a reminder, not a nag. Storage that throws simply shows it again. */
function shownRecently(level: string): boolean {
  try {
    const raw = localStorage.getItem(SHOWN_KEY);
    const last = raw ? (JSON.parse(raw) as { level?: string; at?: number }) : null;
    return last?.level === level && Date.now() - (last.at ?? 0) < DAY_MS;
  } catch {
    return false;
  }
}

function remember(level: string): void {
  try {
    localStorage.setItem(SHOWN_KEY, JSON.stringify({ level, at: Date.now() }));
  } catch {
    // Private mode or storage blocked: the warning may show again, which is harmless.
  }
}

/**
 * In the app shell: when my files reach 90% of my limit (or fill it), a toast says so, with a way to
 * Settings → Storage. Checked on start, every 15 minutes, and whenever an upload finishes.
 */
export function StorageWarningHost() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const usage = useQuery({
    queryKey: storageQueryKey,
    queryFn: storageApi.mine,
    staleTime: 60_000,
    refetchInterval: 15 * 60_000,
  });

  useEffect(
    () =>
      onStorageChanged(() => {
        void queryClient.invalidateQueries({ queryKey: storageQueryKey });
      }),
    [queryClient],
  );

  useEffect(() => {
    if (!usage.data) return;
    const level = storageLevel(usage.data);
    if (level === 'ok' || shownRecently(level)) return;
    remember(level);
    const size = (bytes: number) => formatBytes(bytes, i18n.language);
    toast.warning(t(level === 'full' ? 'storage.toastFull' : 'storage.toastNearlyFull'), {
      description: t('storage.usedOf', {
        used: size(takenBytes(usage.data)),
        limit: size(usage.data.quotaBytes),
      }),
      action: {
        label: t('storage.open'),
        onClick: () => void navigate({ to: '/settings/storage' }),
      },
      duration: 10_000,
    });
  }, [usage.data, t, i18n.language, navigate]);

  return null;
}
