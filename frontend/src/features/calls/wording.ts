import { formatCallDuration, parseCallSystemValue, type SystemEvent } from '@zuvo/protocol';
import type { TFunction } from 'i18next';

/**
 * A call's line in the chat, as I see it: "Voice call · 2:31" when it was answered; for the person
 * called, "Missed voice call" (or "Declined voice call"); for the caller, "Voice call · No answer"
 * (or "· Busy").
 */
export function callSystemText(event: SystemEvent, me: string, t: TFunction): string {
  const parsed = parseCallSystemValue(event.value);
  if (!parsed) return t('calls.call');
  if (parsed.outcome === 'answered') {
    return t('calls.system.answered', { duration: formatCallDuration(parsed.seconds) });
  }
  const iCalled = event.actor?.id === me;
  if (!iCalled)
    return t(parsed.outcome === 'declined' ? 'calls.system.declined' : 'calls.system.missed');
  return t(parsed.outcome === 'busy' ? 'calls.system.busy' : 'calls.system.noAnswer');
}
