import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SettingsSection } from '@/features/settings/SettingsPage';
import { appearanceQuery } from '../api';
import { useUpdateAppearance } from '../mutations';
import { useResolvedTheme } from '../use-resolved-theme';
import { AccentPicker } from './AccentPicker';
import { DimSlider } from './DimSlider';
import { WallpaperPicker } from './WallpaperPicker';

/** Settings → Appearance: accent, default wallpaper and (dark theme) dimming. Loaded on first visit. */
export default function AppearanceSettings() {
  const { t } = useTranslation();
  const theme = useResolvedTheme();
  const { data, isPending, isError, refetch } = useQuery(appearanceQuery);
  const save = useUpdateAppearance();

  if (isPending) {
    return (
      <SettingsSection>
        <div role="status" aria-busy="true" aria-label={t('common.loading')}>
          <Skeleton className="h-10 w-full" />
        </div>
      </SettingsSection>
    );
  }
  if (isError) {
    return (
      <SettingsSection>
        <div role="alert" className="flex items-center gap-3 text-sm text-danger">
          {t('appearance.loadFailed')}
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      </SettingsSection>
    );
  }
  return (
    <>
      <SettingsSection title={t('appearance.accent')}>
        <p className="text-sm text-text-muted">{t('appearance.accentHint')}</p>
        <AccentPicker value={data.accent} onChange={(accent) => save.mutate({ accent })} />
      </SettingsSection>
      <SettingsSection title={t('appearance.wallpaper')}>
        <p className="text-sm text-text-muted">{t('appearance.wallpaperHint')}</p>
        <WallpaperPicker
          value={data.wallpaper}
          onChange={(wallpaper) => (wallpaper ? save.mutate({ wallpaper }) : undefined)}
        />
      </SettingsSection>
      <SettingsSection title={t('appearance.dim')}>
        {theme === 'dark' ? (
          <DimSlider value={data.dim} onChange={(dim) => save.mutate({ dim })} />
        ) : (
          <p className="text-sm text-text-muted">{t('appearance.dimDarkOnly')}</p>
        )}
      </SettingsSection>
    </>
  );
}
