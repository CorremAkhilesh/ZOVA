import { USERNAME_MAX } from '@zuvo/protocol';
import { AtSign, Check, Loader2, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { UsernameStatus } from '../use-username-check';

interface UsernameFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  status: UsernameStatus;
  autoFocus?: boolean;
}

/** "@username" input with the live rule/availability result announced to screen readers. */
export function UsernameField({ id, value, onChange, status, autoFocus }: UsernameFieldProps) {
  const { t } = useTranslation();
  const messageId = `${id}-status`;
  const message = statusMessage(status, t);
  const bad = status.state === 'problem' || status.state === 'error';

  return (
    <div className="space-y-1.5">
      <div className="relative">
        <AtSign
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-text-muted"
          aria-hidden
        />
        <Input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/^@+/, ''))}
          autoComplete="username"
          autoCapitalize="none"
          spellCheck={false}
          autoFocus={autoFocus}
          maxLength={USERNAME_MAX + 1}
          className="pl-9"
          aria-invalid={bad}
          aria-describedby={messageId}
        />
      </div>
      <p
        id={messageId}
        aria-live="polite"
        className={cn(
          'flex min-h-5 items-center gap-1.5 text-sm',
          bad ? 'text-danger' : status.state === 'available' ? 'text-success' : 'text-text-muted',
        )}
      >
        {status.state === 'checking' ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : null}
        {status.state === 'available' ? <Check className="size-3.5" aria-hidden /> : null}
        {bad ? <X className="size-3.5" aria-hidden /> : null}
        {message}
      </p>
    </div>
  );
}

function statusMessage(status: UsernameStatus, t: (key: string) => string): string {
  switch (status.state) {
    case 'idle':
      return t('profile.username.rules');
    case 'checking':
      return t('profile.username.checking');
    case 'available':
      return t('profile.username.available');
    case 'unchanged':
      return t('profile.username.current');
    case 'error':
      return t('profile.username.checkFailed');
    case 'problem':
      return t(`profile.username.${status.reason}`);
  }
}
