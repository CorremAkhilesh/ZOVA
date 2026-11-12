import type { Wallpaper } from '@zuvo/protocol';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useChat } from '@/features/chats/queries';
import { useAppearance } from '../api';
import { useSetChatWallpaper } from '../mutations';
import { WallpaperPicker } from './WallpaperPicker';

/** One chat's own wallpaper, or "Use default". Loaded the first time it opens. */
export default function ChatWallpaperDialog(props: { chatId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const row = useChat(props.chatId);
  const appearance = useAppearance();
  const save = useSetChatWallpaper(props.chatId);
  const value: Wallpaper | null = row?.wallpaper ?? null;
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : props.onClose())}>
      <DialogContent
        title={t('appearance.chatWallpaper')}
        description={t('appearance.chatWallpaperHint')}
        className="max-w-lg"
      >
        <div className="min-h-0 overflow-y-auto">
          {row === null ? (
            <p role="alert" className="text-sm text-danger">
              {t('appearance.chatMissing')}
            </p>
          ) : (
            <WallpaperPicker
              value={value}
              defaultOption={appearance.wallpaper}
              onChange={(wallpaper) => save.mutate(wallpaper)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
