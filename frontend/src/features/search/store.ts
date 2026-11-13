import { create } from 'zustand';

interface GlobalSearch {
  open: boolean;
  /** What the dialog starts with, such as the text already in the chat list's search box. */
  initial: string;
  show: (initial?: string) => void;
  hide: () => void;
}

/** The search dialog (Ctrl/Cmd+K, or from the chat list's search box). */
export const useGlobalSearch = create<GlobalSearch>()((set) => ({
  open: false,
  initial: '',
  show: (initial = '') => set({ open: true, initial }),
  hide: () => set({ open: false, initial: '' }),
}));
