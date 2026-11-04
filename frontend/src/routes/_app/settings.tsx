import { createFileRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { InstallSetting } from '@/features/install/InstallUi';
import { ThemeSwitcher } from '@/features/theme/ThemeSwitcher';
import { LANGUAGES } from '@/lib/i18n';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/_app/settings')({
  component: Settings,
});

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border bg-surface p-5 shadow-sm">
      <h2 className="mb-4 text-sm font-semibold tracking-wide text-text-muted uppercase">
        {title}
      </h2>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

/** Settings placeholder: theme and language work; the rest arrives with accounts. */
function Settings() {
  const { t, i18n } = useTranslation();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-4 p-4 md:p-8">
        <h1 className="text-2xl font-bold tracking-tight">{t('settings.title')}</h1>

        <Section title={t('settings.appearance')}>
          <div className="space-y-2">
            <p className="font-medium">{t('settings.theme')}</p>
            <ThemeSwitcher />
          </div>
        </Section>

        <Section title={t('settings.language')}>
          <div className="space-y-2">
            <p className="text-sm text-text-muted">{t('settings.languageHint')}</p>
            <div role="radiogroup" aria-label={t('settings.language')} className="flex gap-2">
              {LANGUAGES.map(({ code, label }) => {
                const selected = i18n.resolvedLanguage === code;
                return (
                  // biome-ignore lint/a11y/useSemanticElements: segmented control styled as buttons
                  <button
                    key={code}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    lang={code}
                    onClick={() => void i18n.changeLanguage(code)}
                    className={cn(
                      'rounded-lg border px-4 py-2 text-sm font-medium transition-colors',
                      selected
                        ? 'border-brand bg-brand-subtle text-brand-text'
                        : 'text-text-muted hover:text-text',
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </Section>

        <Section title={t('install.settingsTitle')}>
          <InstallSetting />
        </Section>

        <Section title={t('settings.account')}>
          <p className="text-sm text-text-muted">{t('settings.accountSoon')}</p>
        </Section>
      </div>
    </div>
  );
}
