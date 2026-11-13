import type { ReplyQuote } from '@zuvo/protocol';
import { create } from 'zustand';
import type { ChatMessage, ChatSummary } from '@/features/chats/types';

export interface EditTarget {
  chatId: string;
  messageId: string;
  seq: number;
  text: string;
}

export interface MenuRequest {
  message: ChatMessage;
  /** Every item of an album, or just the message. */
  items: ChatMessage[];
  x: number;
  y: number;
}

export interface ChatMenuRequest {
  chat: ChatSummary;
  x: number;
  y: number;
}

interface MessageUi {
  replies: Record<string, ReplyQuote | undefined>;
  editing: EditTarget | null;
  selecting: string | null;
  selected: ChatMessage[];
  menu: MenuRequest | null;
  chatMenu: ChatMenuRequest | null;
  forwarding: ChatMessage[] | null;
  deleting: ChatMessage[] | null;
  whoReacted: ChatMessage | null;
  /** Scroll to this position once the chat shows it. */
  jump: { chatId: string; seq: number } | null;

  setReply(chatId: string, quote: ReplyQuote | undefined): void;
  setEditing(target: EditTarget | null): void;
  startSelecting(chatId: string, message: ChatMessage): void;
  toggleSelected(message: ChatMessage): void;
  stopSelecting(): void;
  set(partial: Partial<MessageUi>): void;
  /** Esc: lets go of the nearest thing in progress. False when there was none. */
  cancelOne(chatId: string | undefined): boolean;
}

export const useMessageUi = create<MessageUi>((set, get) => ({
  replies: {},
  editing: null,
  selecting: null,
  selected: [],
  menu: null,
  chatMenu: null,
  forwarding: null,
  deleting: null,
  whoReacted: null,
  jump: null,

  setReply(chatId, quote) {
    set((state) => ({ replies: { ...state.replies, [chatId]: quote }, editing: null }));
  },
  setEditing(editing) {
    set(
      editing
        ? (state) => ({ editing, replies: { ...state.replies, [editing.chatId]: undefined } })
        : { editing: null },
    );
  },
  startSelecting(selecting, message) {
    set({ selecting, selected: [message], editing: null, menu: null });
  },
  toggleSelected(message) {
    const { selected } = get();
    const has = selected.some((item) => item.id === message.id);
    const next = has ? selected.filter((item) => item.id !== message.id) : [...selected, message];
    set(next.length === 0 ? { selected: [], selecting: null } : { selected: next });
  },
  stopSelecting() {
    set({ selecting: null, selected: [] });
  },
  set(partial) {
    set(partial);
  },
  cancelOne(chatId) {
    const { selecting, editing, replies, stopSelecting, setEditing, setReply } = get();
    if (selecting) {
      stopSelecting();
      return true;
    }
    if (editing) {
      setEditing(null);
      return true;
    }
    if (chatId && replies[chatId]) {
      setReply(chatId, undefined);
      return true;
    }
    return false;
  },
}));
