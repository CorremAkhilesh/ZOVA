import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type Appearance, DEFAULT_APPEARANCE, type Wallpaper } from '@zuvo/protocol';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useLocalDb } from '@/features/chats/queries';
import { APPEARANCE_KEY, appearanceApi, WALLPAPER_IMAGES_KEY } from './api';

/** Saves at once (shown before the server answers, put back if it refuses); my other devices follow. */
export function useUpdateAppearance() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: Partial<Appearance>) => appearanceApi.update(changes),
    onMutate: async (changes) => {
      await queryClient.cancelQueries({ queryKey: APPEARANCE_KEY });
      const previous = queryClient.getQueryData<Appearance>(APPEARANCE_KEY);
      queryClient.setQueryData<Appearance>(APPEARANCE_KEY, {
        ...(previous ?? DEFAULT_APPEARANCE),
        ...changes,
      });
      return { previous };
    },
    onSuccess: ({ appearance }) => queryClient.setQueryData(APPEARANCE_KEY, appearance),
    onError: (_error, _changes, context) => {
      queryClient.setQueryData(APPEARANCE_KEY, context?.previous ?? DEFAULT_APPEARANCE);
      toast.error(t('appearance.saveFailed'));
    },
  });
}

/** Deletes one of my pictures. A chat or default that used it falls back on the server; refetch. */
export function useRemoveWallpaperImage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => appearanceApi.removeImage(id),
    onSuccess: (_ok, id) => {
      queryClient.setQueryData<Array<{ id: string; url: string }>>(WALLPAPER_IMAGES_KEY, (list) =>
        list?.filter((image) => image.id !== id),
      );
      void queryClient.invalidateQueries({ queryKey: APPEARANCE_KEY });
    },
    onError: () => toast.error(t('appearance.deleteFailed')),
  });
}

/** This chat's own wallpaper (null: my default). Written to the local row at once; sync confirms. */
export function useSetChatWallpaper(chatId: string) {
  const { t } = useTranslation();
  const db = useLocalDb();
  return useMutation({
    mutationFn: (wallpaper: Wallpaper | null) => appearanceApi.setChatWallpaper(chatId, wallpaper),
    onMutate: async (wallpaper) => {
      const previous = (await db?.chats.get(chatId))?.wallpaper ?? null;
      await db?.chats.update(chatId, { wallpaper });
      return { previous };
    },
    onError: async (_error, _wallpaper, context) => {
      await db?.chats.update(chatId, { wallpaper: context?.previous ?? null });
      toast.error(t('appearance.saveFailed'));
    },
  });
}
