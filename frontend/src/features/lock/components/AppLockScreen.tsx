import { brand } from '@zuvo/config';
import { useTranslation } from 'react-i18next';
import { Logo } from '@/components/common/Logo';
import { useLockStore } from '../store';
import { PinPrompt } from './PinPrompt';

/** Full screen, over everything (which is inert meanwhile): the PIN, or Windows Hello. */
export default function AppLockScreen() {
  const { t } = useTranslation();
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="app-lock-title"
      className="flex min-h-full flex-col items-center justify-center gap-6 p-6"
    >
      <Logo />
      <div className="space-y-1 text-center">
        <h1 id="app-lock-title" className="text-2xl font-bold tracking-tight">
          {t('lock.appLockedTitle', { name: brand.name })}
        </h1>
        <p className="text-sm text-text-muted">{t('lock.appLockedHint')}</p>
      </div>
      <PinPrompt
        label={t('lock.enterPin')}
        onUnlocked={() => useLockStore.getState().unlockApp()}
      />
    </div>
  );
}
