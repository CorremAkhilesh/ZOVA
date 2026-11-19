import { Download } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useInstallAvailability, useInstallStore } from '@/features/install/install-store';
import { PromoFrame } from './PromoFrame';

type Choice = { kind: 'install'; method: 'prompt' | 'ios' } | null;

/** One promo per visit: once one is closed, done or no longer needed, the list stays clear. */
let closedThisVisit = false;
/** Tests: a new visit. */
export function resetPromoVisit() {
  closedThisVisit = false;
}

/**
 * "Install the app". Notifications have their own full-screen step and banner (NotificationsNudge),
 * so the list never offers them too.
 */
function usePromoChoice(): Choice {
  const install = useInstallAvailability();
  if (install.showBanner && install.method) return { kind: 'install', method: install.method };
  return null;
}

function InstallPromo({ method, onClosed }: { method: 'prompt' | 'ios'; onClosed: () => void }) {
  const { t } = useTranslation();
  const titleId = useId();
  const store = useInstallStore.getState;
  const start = () => {
    if (method === 'prompt') void store().promptInstall();
    else store().setIosSheetOpen(true);
  };
  return (
    <PromoFrame
      titleId={titleId}
      icon={<Download className="size-4" />}
      title={t('promo.installText')}
      action={
        <Button size="sm" className="shrink-0" onClick={start}>
          {method === 'ios' ? t('install.howTo') : t('install.install')}
        </Button>
      }
      onNotNow={() => {
        store().dismissBanner();
        onClosed();
      }}
    />
  );
}

interface PromoBarProps {
  /** Told whether a bar is on screen, so the list can leave room at its end. */
  onShownChange: (shown: boolean) => void;
}

/**
 * The chat list's promo bar: "Install the app". Loaded lazily, and
 * only once the list has painted (`usePromoReady`).
 */
export default function PromoBar({ onShownChange }: PromoBarProps) {
  const choice = usePromoChoice();
  const [kind, setKind] = useState<'install' | null>(null);
  const [closed, setClosed] = useState(closedThisVisit);
  const live = choice;
  // The first promo shown is the only one this visit: when it goes, nothing replaces it.
  const liveKind = live?.kind ?? null;
  useEffect(() => {
    if (!kind && liveKind && !closed) setKind(liveKind);
  }, [closed, kind, liveKind]);
  const shown = !closed && live !== null && (kind === null || live.kind === kind) ? live : null;
  const close = () => {
    closedThisVisit = true;
    setClosed(true);
  };
  const gone = kind !== null && shown === null;
  useEffect(() => {
    if (!gone) return;
    closedThisVisit = true;
    setClosed(true);
  }, [gone]);
  const visible = shown !== null;
  useEffect(() => {
    onShownChange(visible);
  }, [onShownChange, visible]);
  useEffect(() => () => onShownChange(false), [onShownChange]);

  if (!shown) return null;
  return <InstallPromo method={shown.method} onClosed={close} />;
}
