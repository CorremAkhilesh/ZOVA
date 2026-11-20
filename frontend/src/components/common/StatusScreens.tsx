import { Link } from '@tanstack/react-router';
import { Compass, MessagesSquare, TriangleAlert } from 'lucide-react';
import type * as React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

function Centered({
  icon,
  title,
  children,
  page = false,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  /** A whole screen of its own (not found, error): its title is the page's h1. */
  page?: boolean;
}) {
  const Heading = page ? 'h1' : 'h2';
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="flex size-20 items-center justify-center rounded-3xl bg-brand-subtle text-brand-text">
        {icon}
      </div>
      <Heading className="text-xl font-semibold">{title}</Heading>
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

/** `chat`: a chat that does not exist or is not mine, rather than an unknown address. */
export function NotFound({ what = 'page' }: { what?: 'page' | 'chat' }) {
  const { t } = useTranslation();
  const chat = what === 'chat';
  return (
    <Centered
      page
      icon={<Compass className="size-9" aria-hidden />}
      title={t(chat ? 'errors.chatNotFoundTitle' : 'errors.notFoundTitle')}
    >
      <p className="text-sm text-text-muted">
        {t(chat ? 'errors.chatNotFoundBody' : 'errors.notFoundBody')}
      </p>
      <Button asChild>
        <Link to="/chats">{t('errors.goHome')}</Link>
      </Button>
    </Centered>
  );
}

export function ErrorScreen({ onRetry }: { onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <Centered
      page
      icon={<TriangleAlert className="size-9" aria-hidden />}
      title={t('errors.title')}
    >
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
