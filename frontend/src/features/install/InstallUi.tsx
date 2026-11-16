import { CheckCircle2, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
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
