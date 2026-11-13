import { Link } from '@tanstack/react-router';
import { Compass, MessagesSquare, TriangleAlert } from 'lucide-react';
import type * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

function Centered({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex size-20 items-center justify-center rounded-3xl bg-brand-subtle text-brand-text">
        {icon}
      </div>
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </div>
  );
}

export function EmptyConversation() {
  const { t } = useTranslation();
  return (
    <div className="chat-wallpaper h-full">
      <Centered icon={<MessagesSquare className="size-9" aria-hidden />} title={t('empty.title')}>
        <p className="max-w-sm text-sm text-text-muted">{t('empty.body')}</p>
      </Centered>
    </div>
  );
}

export function NotFound() {
  const { t } = useTranslation();
  return (
    <Centered icon={<Compass className="size-9" aria-hidden />} title={t('errors.notFoundTitle')}>
      <p className="text-sm text-text-muted">{t('errors.notFoundBody')}</p>
      <Button asChild>
        <Link to="/chats">{t('errors.goHome')}</Link>
      </Button>
    </Centered>
  );
}

export function ErrorScreen({ onRetry }: { onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <Centered icon={<TriangleAlert className="size-9" aria-hidden />} title={t('errors.title')}>
      <p className="max-w-sm text-sm text-text-muted">{t('errors.body')}</p>
      <Button onClick={onRetry ?? (() => window.location.reload())}>{t('errors.retry')}</Button>
    </Centered>
  );
}

export function Placeholder({
  title,
  body,
  icon,
}: {
  title: string;
  body: string;
  icon: React.ReactNode;
}) {
  return (
    <Centered icon={icon} title={title}>
      <p className="max-w-sm text-sm text-text-muted">{body}</p>
    </Centered>
  );
}
