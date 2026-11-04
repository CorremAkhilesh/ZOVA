import { CheckCircle2, Download, PlusSquare, Share, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Dialog } from 'radix-ui';
import { useTranslation } from 'react-i18next';
import { Logo } from '@/components/common/Logo';
import { Button } from '@/components/ui/button';
import { useInstallAvailability, useInstallStore } from './install-store';

/** Starts the right install flow: the browser prompt, or the iOS instructions sheet. */
function useStartInstall() {
  const { method } = useInstallAvailability();
  const promptInstall = useInstallStore((state) => state.promptInstall);
  const setIosSheetOpen = useInstallStore((state) => state.setIosSheetOpen);
  return () => {
    if (method === 'prompt') void promptInstall();
    else if (method === 'ios') setIosSheetOpen(true);
  };
}

/** Dismissible banner at the top of the app. The dismissal is remembered. */
export function InstallBanner() {
  const { t } = useTranslation();
  const { showBanner, method } = useInstallAvailability();
  const dismiss = useInstallStore((state) => state.dismissBanner);
  const start = useStartInstall();

  return (
    <AnimatePresence>
      {showBanner ? (
        <motion.aside
          aria-label={t('install.bannerLabel')}
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="overflow-hidden border-b bg-brand-subtle"
        >
          <div className="flex items-center gap-3 px-4 py-2">
            <Logo className="[&_svg]:size-7" />
            <p className="min-w-0 flex-1 text-sm text-text">{t('install.bannerText')}</p>
            <Button size="sm" onClick={start}>
              {method === 'ios' ? t('install.howTo') : t('install.install')}
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={dismiss}
              aria-label={t('install.dismiss')}
            >
              <X className="size-4" />
            </Button>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  );
}

/** Settings entry: install button, or "installed" when running as an app. */
export function InstallSetting() {
  const { t } = useTranslation();
  const { method } = useInstallAvailability();
  const start = useStartInstall();

  if (method === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-text-muted">
        <CheckCircle2 className="size-4 text-accent-text" aria-hidden />
        {t('install.unavailableOrInstalled')}
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-text-muted">{t('install.settingsHint')}</p>
      <Button onClick={start}>
        <Download className="size-4" aria-hidden />
        {t('install.installApp')}
      </Button>
    </div>
  );
}

/** Step-by-step "Share → Add to Home Screen" sheet for iPhone and iPad Safari. */
export function IosInstallSheet() {
  const { t } = useTranslation();
  const open = useInstallStore((state) => state.iosSheetOpen);
  const setOpen = useInstallStore((state) => state.setIosSheetOpen);
  const steps = [
    { icon: Share, text: t('install.iosStep1') },
    { icon: PlusSquare, text: t('install.iosStep2') },
    { icon: CheckCircle2, text: t('install.iosStep3') },
  ];

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[1200] bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="fixed inset-x-0 bottom-0 z-[1300] mx-auto max-w-md rounded-t-3xl border bg-surface p-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-lg">
          <Dialog.Title className="text-lg font-semibold">{t('install.iosTitle')}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-text-muted">
            {t('install.iosDescription')}
          </Dialog.Description>
          <ol className="mt-5 space-y-3">
            {steps.map(({ icon: Icon, text }, index) => (
              <li
                key={text}
                className="flex items-center gap-3 rounded-xl bg-background p-3 text-sm"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand text-xs font-bold text-brand-foreground">
                  {index + 1}
                </span>
                <span className="flex-1">{text}</span>
                <Icon className="size-5 text-brand-text" aria-hidden />
              </li>
            ))}
          </ol>
          <Dialog.Close asChild>
            <Button variant="outline" className="mt-5 w-full">
              {t('install.gotIt')}
            </Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
