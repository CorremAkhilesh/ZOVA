import { brand } from '@zuvo/config';
import { BellRing, X } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useInstallStore } from '@/features/install/install-store';
import { usePushState } from '../api';
import { usePushPrefs } from '../prefs';
import { isPushProblem as isProblem, usePushStatus, usePushToggle } from '../status';
import { PermissionHelp } from './PermissionHelp';

/**
 * Top of the chat list, once there is a chat: "Get notified about new messages". The browser is
 * only asked after a click on Enable. Closing it is remembered on this device.
 */
export default function PushCard() {
  const { t } = useTranslation();
  const titleId = useId();
  const status = usePushStatus();
  const publicKey = usePushState().data?.publicKey ?? null;
  const dismiss = usePushPrefs((state) => state.dismissCard);
  const toggle = usePushToggle();
  const [busy, setBusy] = useState(false);
  // Only these speak to the user; on, off and "no server key" hide the card.
  if (!status || !publicKey || (status !== 'ask' && !isProblem(status))) return null;

  const enable = async () => {
    setBusy(true);
    const result = await toggle(true, publicKey);
    setBusy(false);
    if (result === 'on') toast.success(t('notifications.enabled'));
    else if (result === 'failed') toast.error(t('notifications.failed'));
  };

  return (
    <aside
      aria-labelledby={titleId}
      className="mx-4 mb-2 flex items-start gap-3 rounded-2xl border border-brand/20 bg-brand-subtle p-3"
    >
      <span className="rounded-full bg-surface p-2 text-brand-text">
        <BellRing className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        {status === 'ask' ? (
          <>
            <p id={titleId} className="text-sm font-semibold">
              {t('notifications.card.title')}
            </p>
            <p className="text-sm text-text-muted">
              {t('notifications.card.text', { brand: brand.name })}
            </p>
            <Button size="sm" onClick={() => void enable()} disabled={busy}>
              {busy ? t('notifications.enabling') : t('notifications.card.enable')}
            </Button>
          </>
        ) : isProblem(status) ? (
          <>
            <PermissionHelp problem={status} titleId={titleId} />
            {status === 'ios-install' ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => useInstallStore.getState().setIosSheetOpen(true)}
              >
                {t('install.howTo')}
              </Button>
            ) : null}
          </>
        ) : null}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={dismiss}
        aria-label={t('notifications.card.dismiss')}
      >
        <X className="size-4" />
      </Button>
    </aside>
  );
}
