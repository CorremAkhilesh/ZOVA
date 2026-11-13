import { create } from 'zustand';

interface ShortcutsHelp {
  open: boolean;
  show: () => void;
  hide: () => void;
  toggle: () => void;
}

/** The keyboard shortcuts dialog (Ctrl/Cmd+/, or from the command palette). */
export const useShortcutsHelp = create<ShortcutsHelp>()((set) => ({
  open: false,
  show: () => set({ open: true }),
  hide: () => set({ open: false }),
  toggle: () => set((state) => ({ open: !state.open })),
}));
