import { brand } from '@zuvo/config';
import { BellRing, Share, ShieldAlert, SquarePlus } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useInstallStore } from '@/features/install/install-store';
import { useNudgeStore } from '../nudge';
import { type PushStatus, usePushToggle } from '../status';
import { permissionChanged } from '../support';
import { PermissionHelp } from './PermissionHelp';

function Frame(props: { icon: ReactNode; title: string; text: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-background p-4"
    >
      <div className="w-full max-w-md space-y-6 py-8 text-center">
        <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-brand-subtle text-brand-text">
          {props.icon}
        </div>
        <div className="space-y-2">
          <h1 id={titleId} className="font-semibold text-2xl">
            {props.title}
          </h1>
          <p className="text-text-muted">{props.text}</p>
        </div>
        {props.children}
      </div>
    </div>
  );
}

function IosSteps() {
  const { t } = useTranslation();
  const vars = { brand: brand.name };
  return (
    <ol className="space-y-3 rounded-2xl border bg-surface p-4 text-left text-sm">
      <li className="flex items-center gap-3">
        <Share className="size-5 shrink-0 text-brand-text" aria-hidden />
        {t('notifications.gate.iosStep1')}
      </li>
      <li className="flex items-center gap-3">
        <SquarePlus className="size-5 shrink-0 text-brand-text" aria-hidden />
        {t('notifications.gate.iosStep2')}
      </li>
      <li className="flex items-center gap-3">
        <BellRing className="size-5 shrink-0 text-brand-text" aria-hidden />
        {t('notifications.gate.iosStep3', vars)}
      </li>
    </ol>
  );
}

/**
 * The full-screen "Turn on notifications" step (nudge.ts): one big button that asks the browser; on
 * an iPhone outside the installed app, how to add it to the Home Screen first; when the browser
 * blocks notifications, how to allow them again. "Later" leaves a banner until they are on.
 */
export function NudgeScreen({ status, publicKey }: { status: PushStatus; publicKey: string }) {
  const { t } = useTranslation();
  const vars = { brand: brand.name };
  const putOff = useNudgeStore((state) => state.putOff);
  const toggle = usePushToggle();
  const [busy, setBusy] = useState(false);
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(() => primary.current?.focus(), []);

  const later = (
    <Button variant="ghost" className="w-full" onClick={putOff}>
      {t('notifications.gate.later')}
    </Button>
  );

  if (status === 'ios-install') {
    return (
      <Frame
        icon={<SquarePlus className="size-10" aria-hidden />}
        title={t('notifications.ios.title', vars)}
        text={t('notifications.gate.iosText', vars)}
      >
        <IosSteps />
        <Button
          ref={primary}
          size="lg"
          className="w-full"
          onClick={() => useInstallStore.getState().setIosSheetOpen(true)}
        >
          {t('install.howTo')}
        </Button>
        {later}
      </Frame>
    );
  }

  if (status === 'denied') {
    return (
      <Frame
        icon={<ShieldAlert className="size-10" aria-hidden />}
        title={t('notifications.denied.title')}
        text={t('notifications.gate.deniedText', vars)}
      >
        <div className="rounded-2xl border bg-surface p-4 text-left">
          <PermissionHelp problem="denied" stepsOnly />
        </div>
        <Button ref={primary} size="lg" className="w-full" onClick={() => permissionChanged()}>
          {t('notifications.gate.checkAgain')}
        </Button>
        {later}
      </Frame>
    );
  }

  const turnOn = async () => {
    setBusy(true);
    const result = await toggle(true, publicKey);
    setBusy(false);
    if (result === 'on') toast.success(t('notifications.enabled'));
    else if (result === 'failed') toast.error(t('notifications.failed'));
  };
  return (
    <Frame
      icon={<BellRing className="size-10" aria-hidden />}
      title={t('notifications.gate.title')}
      text={t('notifications.gate.text', vars)}
    >
      <Button
        ref={primary}
        size="lg"
        className="h-14 w-full text-lg"
        onClick={() => void turnOn()}
        disabled={busy}
      >
        {busy ? t('notifications.enabling') : t('notifications.gate.turnOn')}
      </Button>
      {later}
    </Frame>
  );
}
