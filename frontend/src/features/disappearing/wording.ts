import { disappearTimerSchema } from '@zuvo/protocol';
import type { TFunction } from 'i18next';
import { timerLabel } from './rules';

/** "Asha turned on disappearing messages. New messages will disappear 7 days after they're sent." */
export function disappearingSystemText(actor: string, value: string | null, t: TFunction): string {
  const timer = disappearTimerSchema.safeParse(value);
  if (!timer.success || timer.data === 'off') return t('disappearing.system.off', { actor });
  return t('disappearing.system.on', { actor, duration: timerLabel(timer.data, t) });
}
