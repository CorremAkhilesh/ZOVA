import { create } from 'zustand';

interface InChatSearch {
  /** The chat being searched; bubbles of other chats ignore the term. */
  chatId: string | null;
  /** Marked in matching bubbles. Empty while nothing is typed. */
  term: string;
  open: (chatId: string) => void;
  setTerm: (term: string) => void;
  close: () => void;
}

/** Search in one chat (the header's search icon). One at a time, gone when the chat closes. */
export const useInChatSearch = create<InChatSearch>()((set) => ({
  chatId: null,
  term: '',
  open: (chatId) => set({ chatId, term: '' }),
  setTerm: (term) => set({ term }),
  close: () => set({ chatId: null, term: '' }),
}));
