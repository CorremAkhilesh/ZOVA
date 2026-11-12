import { Timer } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/** Next to a disappearing message's time. */
export function ExpiryMark({ expiresAt }: { expiresAt: string | null | undefined }) {
  const { t, i18n } = useTranslation();
  if (!expiresAt) return null;
  const when = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(expiresAt));
  return (
    <span
      role="img"
      aria-label={t('disappearing.messageMark')}
      title={`${t('disappearing.messageMark')} · ${when}`}
      className="inline-flex"
    >
      <Timer className="size-3" aria-hidden />
    </span>
  );
}

/** Room for the mark in the bubble's corner, so the text never runs under it. */
export const expiryRoom = (expiresAt: string | null | undefined) => (expiresAt ? 'ml-4' : '');
