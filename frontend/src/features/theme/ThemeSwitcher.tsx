import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { onRadioGroupKeyDown } from '@/lib/radio-keys';
import { cn } from '@/lib/utils';
import { type ThemeMode, useThemeStore } from './theme-store';

const OPTIONS: Array<{ mode: ThemeMode; icon: typeof Sun; labelKey: string }> = [
  { mode: 'light', icon: Sun, labelKey: 'settings.themeLight' },
  { mode: 'dark', icon: Moon, labelKey: 'settings.themeDark' },
  { mode: 'system', icon: Monitor, labelKey: 'settings.themeSystem' },
];

/** Segmented light / dark / system control. */
export function ThemeSwitcher({ className }: { className?: string }) {
  const { t } = useTranslation();
  const mode = useThemeStore((state) => state.mode);
  const setMode = useThemeStore((state) => state.setMode);

  return (
    <div
      role="radiogroup"
      aria-label={t('settings.theme')}
      onKeyDown={onRadioGroupKeyDown}
      className={cn('inline-flex rounded-lg border bg-background p-1', className)}
    >
      {OPTIONS.map(({ mode: option, icon: Icon, labelKey }) => {
        const selected = option === mode;
        return (
          // biome-ignore lint/a11y/useSemanticElements: segmented control styled as buttons
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => setMode(option)}
            className={cn(
              'flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors pointer-coarse:min-h-11',
              selected ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text',
            )}
          >
            <Icon className="size-4" aria-hidden />
            {t(labelKey)}
          </button>
        );
      })}
    </div>
  );
}
