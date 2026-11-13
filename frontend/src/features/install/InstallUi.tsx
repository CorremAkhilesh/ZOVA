import { CheckCircle2, Download, X } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
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
        <m.aside
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
        </m.aside>
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
