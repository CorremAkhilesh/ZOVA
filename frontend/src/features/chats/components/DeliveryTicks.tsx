import { Check, CheckCheck, CircleAlert, Clock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { DeliveryStatus } from '../types';

const ICONS = {
  pending: Clock,
  failed: CircleAlert,
  sent: Check,
  delivered: CheckCheck,
  read: CheckCheck,
};

/** Clock while waiting, one tick once sent, two when delivered, two in the accent color when read. */
export function DeliveryTicks({
  status,
  className,
  readClassName = 'text-accent-text',
}: {
  status: DeliveryStatus;
  className?: string;
  /** The read color depends on the background: the bubble has its own, with AA contrast. */
  readClassName?: string;
}) {
  const { t } = useTranslation();
  const Icon = ICONS[status];
  return (
    <Icon
      role="img"
      aria-label={t(`conversation.${status}`)}
      // A new key per state replays the fade, subtly marking the change.
      key={status}
      className={cn(
        'size-4 shrink-0 animate-in fade-in-0 duration-200 motion-reduce:animate-none',
        className,
        status === 'read' && readClassName,
      )}
    />
  );
}
