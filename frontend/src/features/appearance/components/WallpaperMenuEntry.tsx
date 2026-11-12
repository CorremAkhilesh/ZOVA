import { Image } from 'lucide-react';
import { DropdownMenu } from 'radix-ui';
import { useTranslation } from 'react-i18next';
import type { ChatSummary } from '@/features/chats/types';
import { useChatWallpaperPicker } from '../store';

const ITEM =
  'flex cursor-default items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-sm outline-none data-[highlighted]:bg-background';

/** "Wallpaper…" in a chat's menu: this chat's own wallpaper, mine alone. */
export function WallpaperMenuEntry({ chat }: { chat: ChatSummary }) {
  const { t } = useTranslation();
  return (
    <DropdownMenu.Item
      className={ITEM}
      onSelect={() => useChatWallpaperPicker.getState().open(chat.id)}
    >
      <Image className="size-4" aria-hidden />
      {t('appearance.chatWallpaperEllipsis')}
    </DropdownMenu.Item>
  );
}
