import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, useEffect } from 'react';
import { useQuietStoreSync } from '@/features/quiet-hours/quiet';
import { applyAccent } from '../accent';
import { appearanceQuery } from '../api';
import { useChatWallpaperPicker } from '../store';

const ChatWallpaperDialog = lazy(() => import('./ChatWallpaperDialog'));

/**
 * In the signed-in shell: keeps <html data-accent> on my accent (from the server, my other devices
 * via `appearance:updated`, or this one), hosts the per-chat wallpaper picker, and keeps the quiet-hours
 * store (`isQuietNow`, `shouldAlert`) up to date.
 */
export function AppearanceHost() {
  const accent = useQuery(appearanceQuery).data?.accent;
  const chatId = useChatWallpaperPicker((state) => state.chatId);
  const close = useChatWallpaperPicker((state) => state.close);
  useQuietStoreSync();

  useEffect(() => {
    if (accent) applyAccent(accent);
  }, [accent]);

  if (!chatId) return null;
  return (
    <Suspense fallback={null}>
      <ChatWallpaperDialog key={chatId} chatId={chatId} onClose={close} />
    </Suspense>
  );
}
