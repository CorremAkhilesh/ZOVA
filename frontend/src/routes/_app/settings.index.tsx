import { createFileRoute } from '@tanstack/react-router';
import { lazy, type ReactNode, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { AccountSettings } from '@/features/auth/components/AccountSettings';
import { InstallSetting } from '@/features/install/InstallUi';
import { SettingsMenu } from '@/features/settings/SettingsMenu';
import { ThemeSwitcher } from '@/features/theme/ThemeSwitcher';
import { LANGUAGES } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** Not in production builds, which do not even contain the file. MODE, not DEV: DEV follows NODE_ENV,
 * so a build with NODE_ENV=test (as in CI) would count as development. */
const DiagnosticsPanel =
  import.meta.env.MODE !== 'production'
    ? lazy(() => import('@/features/sync/DiagnosticsPanel'))
    : null;

export const Route = createFileRoute('/_app/settings/')({
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

/** Settings: profile and account screens, appearance, language, install and sign out. */
function Settings() {
  const { t, i18n } = useTranslation();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-4 p-4 md:p-8">
        <h1 className="text-2xl font-bold tracking-tight">{t('settings.title')}</h1>

        <SettingsMenu />

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
          <AccountSettings />
        </Section>

        {DiagnosticsPanel ? (
          <Section title={t('settings.about')}>
            <Suspense fallback={null}>
              <DiagnosticsPanel />
            </Suspense>
          </Section>
        ) : null}
      </div>
    </div>
  );
}
