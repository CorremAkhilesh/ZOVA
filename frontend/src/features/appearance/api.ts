import { queryOptions, useQuery } from '@tanstack/react-query';
import {
  type Appearance,
  appearanceResponseSchema,
  DEFAULT_APPEARANCE,
  okResponseSchema,
  type Wallpaper,
  wallpaperImageResponseSchema,
  wallpaperImagesResponseSchema,
} from '@zuvo/protocol';
import { z } from 'zod';
import { apiDelete, apiGet, apiPatch, apiPut, apiUpload } from '@/lib/api-client';

export const appearanceApi = {
  get: () => apiGet('/v1/me/appearance', appearanceResponseSchema),
  update: (changes: Partial<Appearance>) =>
    apiPatch('/v1/me/appearance', changes, appearanceResponseSchema),
  images: () => apiGet('/v1/me/wallpapers', wallpaperImagesResponseSchema),
  upload: (file: Blob, onProgress?: (fraction: number) => void) =>
    apiUpload('/v1/me/wallpapers', file, wallpaperImageResponseSchema, onProgress),
  removeImage: (id: string) =>
    apiDelete(`/v1/me/wallpapers/${encodeURIComponent(id)}`, okResponseSchema),
  /** Mine alone; null goes back to my default. The chat row follows through sync. */
  setChatWallpaper: (chatId: string, wallpaper: Wallpaper | null) =>
    apiPut(`/v1/chats/${encodeURIComponent(chatId)}/wallpaper`, { wallpaper }, z.unknown()),
};

/** Where one of my pictures loads from (the API checks it is mine). */
export const wallpaperImageUrl = (id: string) => `/v1/me/wallpapers/${encodeURIComponent(id)}`;

export const APPEARANCE_KEY = ['me', 'appearance'] as const;
export const WALLPAPER_IMAGES_KEY = ['me', 'wallpapers'] as const;

/** `appearance:updated` writes straight into it; a reconnect refetches it. */
export const appearanceQuery = queryOptions({
  queryKey: APPEARANCE_KEY,
  queryFn: async (): Promise<Appearance> => (await appearanceApi.get()).appearance,
  staleTime: 5 * 60_000,
});

export const wallpaperImagesQuery = queryOptions({
  queryKey: WALLPAPER_IMAGES_KEY,
  queryFn: async () => (await appearanceApi.images()).images,
});

/** My appearance, or the defaults until (or unless) it loads. */
export function useAppearance(): Appearance {
  return useQuery(appearanceQuery).data ?? DEFAULT_APPEARANCE;
}
