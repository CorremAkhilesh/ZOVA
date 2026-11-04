import { Check, CheckCheck } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { DeliveryStatus } from '../types';

/** Sent = one tick, delivered = two ticks, read = two ticks in the accent color. */
export function DeliveryTicks({
  status,
  className,
}: {
  status: DeliveryStatus;
  className?: string;
}) {
  const { t } = useTranslation();
  const Icon = status === 'sent' ? Check : CheckCheck;
  return (
    <Icon
      role="img"
      aria-label={t(`conversation.${status}`)}
      className={cn('size-4 shrink-0', status === 'read' && 'text-accent-text', className)}
    />
  );
}
