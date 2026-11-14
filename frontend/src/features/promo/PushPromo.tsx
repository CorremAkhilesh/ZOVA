import { brand } from '@zuvo/config';
import { BellRing } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useInstallStore } from '@/features/install/install-store';
import { PermissionHelp } from '@/features/notifications/components/PermissionHelp';
import { usePushPrefs } from '@/features/notifications/prefs';
import { type PushProblem, usePushToggle } from '@/features/notifications/status';
import { PromoFrame } from './PromoFrame';

const TITLE_KEYS: Record<PushProblem, string> = {
  denied: 'notifications.denied.title',
  'ios-install': 'notifications.ios.title',
  unsupported: 'notifications.unsupported.title',
};

interface PushPromoProps {
  status: 'ask' | PushProblem;
  publicKey: string;
  onClosed: () => void;
}

/**
 * "Get notified about new messages". The browser is only asked after a click on Enable. When push
 * cannot work here, the bar names the problem and the explanation opens in a dialog.
 */
export function PushPromo({ status, publicKey, onClosed }: PushPromoProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const dismiss = usePushPrefs((state) => state.dismissCard);
  const toggle = usePushToggle();
  const [busy, setBusy] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const enable = async () => {
    setBusy(true);
    const result = await toggle(true, publicKey);
    setBusy(false);
    if (result === 'on') toast.success(t('notifications.enabled'));
    else if (result === 'failed') toast.error(t('notifications.failed'));
  };
  const notNow = () => {
    dismiss();
    onClosed();
  };

  const title =
    status === 'ask' ? t('notifications.card.title') : t(TITLE_KEYS[status], { brand: brand.name });
  const action =
    status === 'ask' ? (
      <Button size="sm" className="shrink-0" onClick={() => void enable()} disabled={busy}>
        {busy ? t('notifications.enabling') : t('notifications.card.enable')}
      </Button>
    ) : status === 'ios-install' ? (
      <Button
        size="sm"
        variant="outline"
        className="shrink-0"
        onClick={() => useInstallStore.getState().setIosSheetOpen(true)}
      >
        {t('install.howTo')}
      </Button>
    ) : (
      <Button size="sm" variant="outline" className="shrink-0" onClick={() => setHelpOpen(true)}>
        {t('promo.learnMore')}
      </Button>
    );

  return (
    <>
      <PromoFrame
        titleId={titleId}
        icon={<BellRing className="size-4" />}
        title={title}
        action={action}
        onNotNow={notNow}
      />
      {status === 'denied' || status === 'unsupported' ? (
        <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
          <DialogContent title={title} hideTitle>
            <PermissionHelp problem={status} />
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
