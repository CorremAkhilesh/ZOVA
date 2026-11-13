import { BellRing, CheckCircle2, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { isStandalone } from '@/features/install/detect';
import { useInstallAvailability, useInstallStore } from '@/features/install/install-store';
import { useHelpText } from '../content';
import { desktopBrowser, type InstallGuide as Guide, installGuideOrder } from '../install-order';
import { HelpPage, HelpSection, Steps } from './HelpPage';

function InstallNow() {
  const { text } = useHelpText();
  const { method } = useInstallAvailability();
  const promptInstall = useInstallStore((state) => state.promptInstall);
  if (isStandalone()) {
    return (
      <p className="flex items-center gap-2 rounded-2xl border bg-surface p-4 text-sm shadow-sm">
        <CheckCircle2 className="size-5 shrink-0 text-accent-text" aria-hidden />
        {text('install.installed')}
      </p>
    );
  }
  if (method !== 'prompt') return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand/30 bg-brand-subtle p-4">
      <p className="text-sm">{text('install.installNowHint')}</p>
      <Button onClick={() => void promptInstall()}>
        <Download className="size-4" aria-hidden />
        {text('install.installNow')}
      </Button>
    </div>
  );
}

function DesktopGuide() {
  const { text, list } = useHelpText();
  const browser = desktopBrowser();
  const parts = [
    {
      id: 'chrome',
      title: text('install.desktop.chrome'),
      steps: list('install.desktop.chromeSteps'),
    },
    { id: 'edge', title: text('install.desktop.edge'), steps: list('install.desktop.edgeSteps') },
  ];
  if (browser === 'edge') parts.reverse();
  return (
    <>
      {browser === 'firefox' ? <p>{text('install.desktop.firefoxNote')}</p> : null}
      {parts.map((part) => (
        <div key={part.id} className="space-y-2">
          <h3 className="font-semibold">{part.title}</h3>
          <Steps items={part.steps} label={part.title} />
        </div>
      ))}
      <p className="text-text-muted">{text('install.desktop.safariNote')}</p>
      {browser === 'firefox' ? null : (
        <p className="text-text-muted">{text('install.desktop.firefoxNote')}</p>
      )}
    </>
  );
}

function IosGuide() {
  const { text, list } = useHelpText();
  return (
    <>
      <Steps items={list('install.ios.steps')} label={text('install.ios.title')} />
      <p className="text-text-muted">{text('install.ios.version')}</p>
      <div className="rounded-xl bg-background p-4">
        <h3 className="mb-1 flex items-center gap-2 font-semibold">
          <BellRing className="size-4 text-brand-text" aria-hidden />
          {text('install.ios.whyTitle')}
        </h3>
        <p>{text('install.ios.why')}</p>
      </div>
    </>
  );
}

function GuideBody({ guide }: { guide: Guide }) {
  const { text, list } = useHelpText();
  if (guide === 'desktop') return <DesktopGuide />;
  if (guide === 'ios') return <IosGuide />;
  return <Steps items={list('install.android.steps')} label={text('install.android.title')} />;
}

/** /help/install: this device's steps first, with "Install now" where the browser offers it. */
export function InstallGuide() {
  const { text } = useHelpText();
  const order = installGuideOrder();
  return (
    <HelpPage title={text('cards.install.title')} description={text('install.subtitle')}>
      <InstallNow />
      {order.map((guide, index) => (
        <HelpSection
          key={guide}
          id={`install-${guide}`}
          title={text(`install.${guide}.title`)}
          className={index === 0 ? 'border-brand/40' : undefined}
        >
          {index === 0 ? (
            <p className="inline-flex rounded-full bg-accent-subtle px-2.5 py-0.5 text-xs font-semibold text-accent-text">
              {text('install.yourDevice')}
            </p>
          ) : null}
          <GuideBody guide={guide} />
        </HelpSection>
      ))}
    </HelpPage>
  );
}
