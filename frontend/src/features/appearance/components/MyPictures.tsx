import { useQuery } from '@tanstack/react-query';
import { WALLPAPER_IMAGES_MAX, type Wallpaper } from '@zuvo/protocol';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { wallpaperImagesQuery, wallpaperImageUrl } from '../api';
import { useRemoveWallpaperImage } from '../mutations';
import { useWallpaperUpload } from '../use-wallpaper-upload';
import { WallpaperTile } from './WallpaperTile';

/** My own pictures: pick one, delete one, or upload another (compressed first). */
export function MyPictures(props: {
  name: string;
  value: Wallpaper | null;
  onChange: (wallpaper: Wallpaper) => void;
}) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const images = useQuery(wallpaperImagesQuery);
  const remove = useRemoveWallpaperImage();
  const { upload, uploading, progress, error } = useWallpaperUpload((image) =>
    props.onChange({ kind: 'image', id: image.id }),
  );
  const list = images.data ?? [];
  const full = list.length >= WALLPAPER_IMAGES_MAX;

  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{t('appearance.myPictures')}</legend>
      {images.isPending ? (
        <div role="status" aria-busy="true" aria-label={t('appearance.picturesLoading')}>
          <Skeleton className="h-16 w-full" />
        </div>
      ) : images.isError ? (
        <div role="alert" className="flex items-center gap-3 text-sm text-danger">
          {t('appearance.picturesFailed')}
          <Button variant="outline" size="sm" onClick={() => void images.refetch()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : list.length === 0 ? (
        <p className="text-sm text-text-muted">{t('appearance.noPictures')}</p>
      ) : (
        <ul className="flex flex-wrap gap-3">
          {list.map((image, index) => {
            const label = t('appearance.picture', { n: index + 1 });
            return (
              <li key={image.id} className="flex flex-col items-center gap-1">
                <WallpaperTile
                  name={props.name}
                  label={label}
                  checked={props.value?.kind === 'image' && props.value.id === image.id}
                  onSelect={() => props.onChange({ kind: 'image', id: image.id })}
                  style={{
                    backgroundImage: `url("${wallpaperImageUrl(image.id)}")`,
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                  }}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('appearance.deletePicture', { name: label })}
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(image.id)}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-label={t('appearance.upload')}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void upload(file);
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          disabled={uploading || full}
          onClick={() => input.current?.click()}
        >
          <ImagePlus className="size-4" aria-hidden />
          {uploading
            ? t('appearance.uploading', { percent: Math.round((progress ?? 0) * 100) })
            : t('appearance.upload')}
        </Button>
        {full ? (
          <p className="text-xs text-text-muted">
            {t('appearance.picturesFull', { max: WALLPAPER_IMAGES_MAX })}
          </p>
        ) : null}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {t(`appearance.uploadError.${error}`)}
        </p>
      ) : null}
    </fieldset>
  );
}
