import { create } from 'zustand';

interface ChatListView {
  /** The chat list shows its archived chats. */
  archived: boolean;
  showArchived: () => void;
  showAll: () => void;
}

/** Which view of the chat list is shown; the command palette's "Go to Archived" sets it. */
export const useChatListView = create<ChatListView>()((set) => ({
  archived: false,
  showArchived: () => set({ archived: true }),
  showAll: () => set({ archived: false }),
}));
