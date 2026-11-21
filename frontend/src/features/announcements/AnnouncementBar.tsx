import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Info, TriangleAlert, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { type AnnouncementBanner, announcementsApi, bannersKey } from './api';

/** Checked every few minutes and when the app comes back to the front. */
const REFRESH_MS = 5 * 60_000;

/**
 * Banners from the admins at the top of the app ("Maintenance tonight at 10"). Each can be closed;
 * closed stays closed on every device. Nothing shows while there are none, or offline.
 */
export function AnnouncementBar() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: bannersKey,
    queryFn: announcementsApi.mine,
    staleTime: 60_000,
    refetchInterval: REFRESH_MS,
    refetchOnWindowFocus: true,
  });
  const dismiss = useMutation({
    mutationFn: (id: string) => announcementsApi.dismiss(id),
    onMutate: (id) =>
      queryClient.setQueryData<{ items: AnnouncementBanner[] }>(bannersKey, (current) =>
        current ? { items: current.items.filter((item) => item.id !== id) } : current,
      ),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: bannersKey }),
  });
  const items = data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <section aria-label={t('announcements.label')} className="space-y-px">
      {items.map((item) => {
        const warning = item.level === 'warning';
        const Icon = warning ? TriangleAlert : Info;
        return (
          <div
            key={item.id}
            className={cn(
              'flex items-start gap-3 border-b px-4 py-2.5 text-sm',
              warning ? 'bg-warning/15' : 'bg-brand-subtle',
            )}
          >
            <Icon
              className={cn('mt-0.5 size-4 shrink-0', warning ? 'text-warning' : 'text-brand-text')}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <p className="font-semibold break-words">{item.title}</p>
              <p className="break-words whitespace-pre-line text-text">{item.body}</p>
              {item.endsAt ? (
                <p className="mt-0.5 text-xs text-text-muted">
                  {t('announcements.until', {
                    when: new Intl.DateTimeFormat(i18n.language, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(item.endsAt)),
                  })}
                </p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss.mutate(item.id)}
              aria-label={t('announcements.close', { title: item.title })}
              className="tap-target -mr-1 flex size-8 shrink-0 items-center justify-center rounded-lg text-text-muted hover:bg-background hover:text-text"
            >
              <X className="size-4" aria-hidden />
            </button>
          </div>
        );
      })}
    </section>
  );
}
