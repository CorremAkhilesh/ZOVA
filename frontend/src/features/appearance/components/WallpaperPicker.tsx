import { WALLPAPER_COLORS, WALLPAPER_PATTERNS, type Wallpaper } from '@zuvo/protocol';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useResolvedTheme } from '../use-resolved-theme';
import { sameWallpaper, wallpaperStyle } from '../wallpaper-style';
import { MyPictures } from './MyPictures';
import { WallpaperTile } from './WallpaperTile';

/**
 * Patterns, colors and my pictures, as one set of radios. With `defaultOption`, a chat can also go
 * back to my default (value null).
 */
export function WallpaperPicker(props: {
  value: Wallpaper | null;
  onChange: (wallpaper: Wallpaper | null) => void;
  defaultOption?: Wallpaper;
}) {
  const { t } = useTranslation();
  const theme = useResolvedTheme();
  const name = useId();
  const { value, onChange, defaultOption } = props;
  const preview = (wallpaper: Wallpaper) => wallpaperStyle(wallpaper, theme, 0);

  return (
    <div className="space-y-4">
      {defaultOption ? (
        <WallpaperTile
          name={name}
          label={t('appearance.useDefault')}
          checked={value === null}
          onSelect={() => onChange(null)}
          style={preview(defaultOption)}
        >
          <span className="rounded bg-surface/80 px-1 text-[10px] font-medium text-text">
            {t('appearance.default')}
          </span>
        </WallpaperTile>
      ) : null}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('appearance.patterns')}</legend>
        <div className="flex flex-wrap gap-3">
          {WALLPAPER_PATTERNS.map((id) => {
            const wallpaper: Wallpaper = { kind: 'pattern', id };
            return (
              <WallpaperTile
                key={id}
                name={name}
                label={t(`appearance.pattern.${id}`)}
                checked={sameWallpaper(value, wallpaper)}
                onSelect={() => onChange(wallpaper)}
                style={preview(wallpaper)}
              />
            );
          })}
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{t('appearance.colors')}</legend>
        <div className="flex flex-wrap gap-3">
          {WALLPAPER_COLORS.map((id) => {
            const wallpaper: Wallpaper = { kind: 'color', id };
            return (
              <WallpaperTile
                key={id}
                name={name}
                label={t(`appearance.color.${id}`)}
                checked={sameWallpaper(value, wallpaper)}
                onSelect={() => onChange(wallpaper)}
                style={preview(wallpaper)}
              />
            );
          })}
        </div>
      </fieldset>
      <MyPictures name={name} value={value} onChange={onChange} />
    </div>
  );
}
