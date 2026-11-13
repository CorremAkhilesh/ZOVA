import { useQueryClient } from '@tanstack/react-query';
import { WALLPAPER_MAX_BYTES } from '@zuvo/protocol';
import { useState } from 'react';
import { prepareImage } from '@/features/media/process';
import { appearanceApi, WALLPAPER_IMAGES_KEY } from './api';

export type UploadError = 'unreadable' | 'tooBig' | 'failed';

type Image = { id: string; url: string };

/** Compresses a picture like a photo message, then adds it to my pictures. */
export function useWallpaperUpload(onUploaded: (image: Image) => void) {
  const queryClient = useQueryClient();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<UploadError | null>(null);

  const upload = async (file: File) => {
    setError(null);
    setProgress(0);
    try {
      const prepared = await prepareImage(file);
      if (prepared.kind !== 'image') {
        setError('unreadable');
        return;
      }
      if (prepared.file.size > WALLPAPER_MAX_BYTES) {
        setError('tooBig');
        return;
      }
      const { image } = await appearanceApi.upload(prepared.file, setProgress);
      queryClient.setQueryData<Image[]>(WALLPAPER_IMAGES_KEY, (list) => [
        ...(list ?? []).filter((item) => item.id !== image.id),
        image,
      ]);
      onUploaded(image);
    } catch {
      setError('failed');
    } finally {
      setProgress(null);
    }
  };

  return { upload, uploading: progress !== null, progress, error };
}
