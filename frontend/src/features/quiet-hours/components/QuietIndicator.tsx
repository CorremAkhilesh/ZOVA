import { Link } from '@tanstack/react-router';
import { Moon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useQuiet } from '../quiet';

/** A small moon while quiet hours are on; opens the settings. Nothing otherwise. */
export function QuietIndicator() {
  const { t } = useTranslation();
  const quiet = useQuiet();
  if (!quiet) return null;
  return (
    <Link
      to="/settings/notifications"
      aria-label={t('quietHours.indicator')}
      title={t('quietHours.indicator')}
      className="inline-flex size-8 items-center justify-center rounded-md text-brand-text hover:bg-background"
    >
      <Moon className="size-4" aria-hidden />
    </Link>
  );
}
