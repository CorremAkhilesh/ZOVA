import { Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { useKnownSignedIn } from '../signed-in';

/** A Help screen: back (to Settings from /help, else to /help), one h1, then the content. */
export function HelpPage({
  title,
  description,
  back = 'help',
  children,
}: {
  title: string;
  description?: string;
  back?: 'settings' | 'help';
  children: ReactNode;
}) {
  const { t } = useTranslation();
  // Signed out there is no Settings to go back to: the header offers "Sign in" instead.
  const signedIn = useKnownSignedIn();
  const showBack = back === 'help' || signedIn;
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl space-y-4 p-4 pb-10 md:p-8">
        {showBack ? (
          <Link
            to={back === 'settings' ? '/settings' : '/help'}
            className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-text-muted hover:text-text"
          >
            <ArrowLeft className="size-4" aria-hidden />
            {back === 'settings' ? t('settings.title') : t('help.menuTitle')}
          </Link>
        ) : null}
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {description ? <p className="text-sm text-text-muted">{description}</p> : null}
        </div>
        {children}
      </div>
    </div>
  );
}

/** A titled card on a Help screen (h2). */
export function HelpSection({
  title,
  children,
  className,
  id,
}: {
  title: string;
  children: ReactNode;
  className?: string | undefined;
  id?: string | undefined;
}) {
  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-title` : undefined}
      className={cn('rounded-2xl border bg-surface p-5 shadow-sm', className)}
    >
      <h2 id={id ? `${id}-title` : undefined} className="mb-3 text-lg font-semibold">
        {title}
      </h2>
      <div className="space-y-3 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

/** A bulleted list of plain sentences. */
export function Points({ items }: { items: readonly string[] }) {
  return (
    <ul className="list-disc space-y-2 ps-5 marker:text-brand-text">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

/** Numbered steps. */
export function Steps({ items, label }: { items: readonly string[]; label?: string }) {
  return (
    <ol aria-label={label} className="space-y-2">
      {items.map((item, index) => (
        <li key={item} className="flex gap-3">
          <span
            aria-hidden
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-subtle text-xs font-bold text-brand-text"
          >
            {index + 1}
          </span>
          <span className="min-w-0 flex-1 pt-0.5">{item}</span>
        </li>
      ))}
    </ol>
  );
}
