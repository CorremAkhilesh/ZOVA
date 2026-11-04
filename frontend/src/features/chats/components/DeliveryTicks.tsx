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
}: {
  status: DeliveryStatus;
  className?: string;
}) {
  const { t } = useTranslation();
  const Icon = ICONS[status];
  return (
    <Icon
      role="img"
      aria-label={t(`conversation.${status}`)}
      className={cn('size-4 shrink-0', status === 'read' && 'text-accent-text', className)}
    />
  );
}
