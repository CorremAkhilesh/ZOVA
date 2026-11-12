import { create } from 'zustand';

interface ChatWallpaperPickerState {
  /** The chat whose wallpaper is being picked; null when closed. */
  chatId: string | null;
  open: (chatId: string) => void;
  close: () => void;
}

/** "Wallpaper" in a chat's menu opens this; AppearanceHost shows the picker. */
export const useChatWallpaperPicker = create<ChatWallpaperPickerState>()((set) => ({
  chatId: null,
  open: (chatId) => set({ chatId }),
  close: () => set({ chatId: null }),
}));
