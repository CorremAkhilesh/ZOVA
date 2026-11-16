import { CheckCircle2, PlusSquare, Share } from 'lucide-react';
import { Dialog } from 'radix-ui';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useBackClose } from '@/lib/back-stack';
import { useInstallStore } from './install-store';

/** Step-by-step "Share → Add to Home Screen" sheet for iPhone and iPad Safari. */
export default function IosInstallSheet() {
  const { t } = useTranslation();
  const open = useInstallStore((state) => state.iosSheetOpen);
  const setOpen = useInstallStore((state) => state.setIosSheetOpen);
  useBackClose(open, () => setOpen(false));
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
