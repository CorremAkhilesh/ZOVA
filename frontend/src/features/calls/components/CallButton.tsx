import { Phone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useCallAccess, useCallState } from '../hooks';
import { inCall } from '../machine';
import { useCallStore } from '../store';

/**
 * 📞 in a 1:1 chat's header and on a person's profile. Only for accounts that have calls (the flag),
 * and never in groups or Saved Messages.
 */
export function CallButton(props: {
  chatId: string;
  name: string;
  direct: boolean;
  className?: string;
  /** On a profile: a button with its words ("Voice call"), not just the icon. */
  labeled?: boolean;
}) {
  const { t } = useTranslation();
  const allowed = useCallAccess();
  const busy = inCall(useCallState());
  const actions = useCallStore((store) => store.actions);
  if (!allowed || !props.direct) return null;
  if (props.labeled) {
    return (
      <Button
        variant="outline"
        disabled={busy || !actions}
        onClick={() => void actions?.dial(props.chatId)}
        className={props.className}
      >
        <Phone className="size-4" aria-hidden />
        {t('calls.call')}
      </Button>
    );
  }
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={t('calls.callName', { name: props.name })}
      disabled={busy || !actions}
      onClick={() => void actions?.dial(props.chatId)}
      className={props.className}
    >
      <Phone className="size-5" aria-hidden />
    </Button>
  );
}
