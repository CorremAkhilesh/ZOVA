import { brand } from '@zuvo/config';
import { BellOff } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { usePushState } from '../api';
import { nudgeFor, useNudgeStore } from '../nudge';
import { type PushStatus, usePushStatus, usePushToggle } from '../status';
import { useReportPushClient } from '../use-report-client';
import { NudgeScreen } from './NudgeScreen';

const BANNER_TEXT: Record<string, string> = {
  ask: 'notifications.banner.ask',
  off: 'notifications.banner.off',
  denied: 'notifications.banner.denied',
  'ios-install': 'notifications.banner.ios',
};

/** Above every screen until push is on here: it cannot be closed, only acted on. */
function NudgeBanner({ status, publicKey }: { status: PushStatus; publicKey: string }) {
  const { t } = useTranslation();
  const openScreen = useNudgeStore((state) => state.openScreen);
  const toggle = usePushToggle();
  const [busy, setBusy] = useState(false);
  const canTurnOn = status === 'ask' || status === 'off';
  const act = async () => {
    if (!canTurnOn) {
      openScreen();
      return;
    }
    setBusy(true);
    const result = await toggle(true, publicKey);
    setBusy(false);
    if (result === 'on') toast.success(t('notifications.enabled'));
    else if (result === 'failed') toast.error(t('notifications.failed'));
  };
  return (
    <section
      aria-label={t('notifications.banner.label')}
      className="flex items-center gap-3 border-b bg-brand-subtle px-4 py-2 text-sm"
    >
      <BellOff className="size-4 shrink-0 text-brand-text" aria-hidden />
      <p className="min-w-0 flex-1">{t(BANNER_TEXT[status] ?? '', { brand: brand.name })}</p>
      <Button size="sm" className="shrink-0" onClick={() => void act()} disabled={busy}>
        {canTurnOn ? t('notifications.banner.turnOn') : t('notifications.banner.howTo')}
      </Button>
    </section>
  );
}

/**
 * In the signed-in shell: the full-screen "Turn on notifications" step or, once put off, the banner
 * (nudge.ts). Also tells the server what this device can do, for Admin → Notifications.
 */
export function NotificationsNudge() {
  const status = usePushStatus();
  const publicKey = usePushState().data?.publicKey ?? null;
  const device = useNudgeStore();
  useReportPushClient(status);
  const nudge = nudgeFor(status, device);
  if (!nudge || !status || !publicKey) return null;
  return nudge === 'screen' ? (
    <NudgeScreen status={status} publicKey={publicKey} />
  ) : (
    <NudgeBanner status={status} publicKey={publicKey} />
  );
}
