import { FlaskConical } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Marks screens that show sample data, so nobody mistakes the preview for real chats. */
export function MockBadge() {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-warning px-2 py-0.5 text-[11px] font-semibold text-warning">
      <FlaskConical className="size-3" aria-hidden />
      {t('mock.badge')}
    </span>
  );
}
