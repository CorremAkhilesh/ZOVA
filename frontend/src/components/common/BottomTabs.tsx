import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { NAV_ITEMS } from './nav-items';

/** Mobile navigation: bottom tab bar. */
export function BottomTabs() {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t('nav.main')}
      className="glass grid shrink-0 grid-cols-4 border-t pb-[env(safe-area-inset-bottom)]"
    >
      {NAV_ITEMS.map(({ to, labelKey, icon: Icon }) => (
        <Link
          key={to}
          to={to}
          className="group flex flex-col items-center gap-1 py-2 text-xs font-medium text-text-muted data-[status=active]:text-brand-text"
        >
          <span className="flex h-7 w-14 items-center justify-center rounded-full transition-colors group-data-[status=active]:bg-brand-subtle">
            <Icon className="size-5" aria-hidden />
          </span>
          {t(labelKey)}
        </Link>
      ))}
    </nav>
  );
}
