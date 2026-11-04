import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/** A settings sub-screen: back to Settings, a title and the content column. */
export function SettingsPage({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-4 p-4 md:p-8">
        <Link
          to="/settings"
          className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-text-muted hover:text-text"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {t('settings.title')}
        </Link>
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {description ? <p className="text-sm text-text-muted">{description}</p> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

export function SettingsSection({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('rounded-2xl border bg-surface p-5 shadow-sm', className)}>
      {title ? (
        <h2 className="mb-4 text-sm font-semibold tracking-wide text-text-muted uppercase">
          {title}
        </h2>
      ) : null}
      <div className="space-y-5">{children}</div>
    </section>
  );
}
