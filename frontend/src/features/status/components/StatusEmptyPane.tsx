import { CircleDashed, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** The right side of the Status tab on wider screens, until someone's status is opened. */
export function StatusEmptyPane() {
  const { t } = useTranslation();
  return (
    <section
      aria-labelledby="status-pane-title"
      className="flex min-w-0 flex-1 flex-col items-center justify-center gap-4 px-8 text-center"
    >
      <span className="grid size-24 place-items-center rounded-full bg-brand-subtle text-brand-text">
        <CircleDashed className="size-12" strokeWidth={1.5} aria-hidden />
      </span>
      <div className="max-w-sm space-y-2">
        <h2 id="status-pane-title" className="text-xl font-semibold">
          {t('updates.paneTitle')}
        </h2>
        <p className="text-text-muted">{t('updates.paneHint')}</p>
      </div>
      <p className="mt-6 flex items-center gap-1.5 text-xs text-text-muted">
        <Lock className="size-3.5" aria-hidden />
        {t('updates.paneNote')}
      </p>
    </section>
  );
}
