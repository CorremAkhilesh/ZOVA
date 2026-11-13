import type { DisappearTimer } from '@zuvo/protocol';
import { Timer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { timerLabel } from './rules';

/** In the chat header while the timer is on. */
export function DisappearingBadge({ timer }: { timer: DisappearTimer | undefined }) {
  const { t } = useTranslation();
  if (!timer || timer === 'off') return null;
  const label = t('disappearing.badge', { duration: timerLabel(timer, t) });
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className="flex shrink-0 items-center gap-0.5 rounded-full bg-brand-subtle px-1.5 py-0.5 text-[11px] font-medium text-brand-text"
    >
      <Timer className="size-3.5" aria-hidden />
      <span aria-hidden>{timer}</span>
    </span>
  );
}
