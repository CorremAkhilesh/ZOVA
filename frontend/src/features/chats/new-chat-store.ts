import { create } from 'zustand';

interface NewChatStore {
  isOpen: boolean;
  open: () => void;
  setOpen: (isOpen: boolean) => void;
}

/** The "New chat" picker: opened from the list, the empty state or Ctrl/Cmd+N. */
export const useNewChat = create<NewChatStore>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  setOpen: (isOpen) => set({ isOpen }),
}));
