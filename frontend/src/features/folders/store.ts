import type { ChatFolderDef } from '@zuvo/protocol';
import { create } from 'zustand';
import type { ChatFolder } from '@/features/chats/types';

export interface FolderEditorRequest {
  /** The folder to edit; null for a new one. */
  folder: ChatFolderDef | null;
  /** A new folder starts with these chats picked. */
  pick?: string[];
}

interface FolderEditorState {
  request: FolderEditorRequest | null;
  open: (request: FolderEditorRequest) => void;
  close: () => void;
}

/** The folder editor, opened from the chips, a chat's menu or Settings. */
export const useFolderEditor = create<FolderEditorState>()((set) => ({
  request: null,
  open: (request) => set({ request }),
  close: () => set({ request: null }),
}));

export const SELECTED_FOLDER_KEY = 'zuvo.chat-folder';
const BUILT_IN = new Set(['all', 'unread', 'personal', 'groups']);

const isChatFolder = (value: string | null): value is ChatFolder =>
  value !== null && (BUILT_IN.has(value) || /^folder:[\w-]+$/.test(value));

/** The chip this device showed last. */
export function readSelectedFolder(): ChatFolder {
  try {
    const value = localStorage.getItem(SELECTED_FOLDER_KEY);
    return isChatFolder(value) ? value : 'all';
  } catch {
    return 'all';
  }
}

export function saveSelectedFolder(folder: ChatFolder) {
  try {
    if (folder === 'all') localStorage.removeItem(SELECTED_FOLDER_KEY);
    else localStorage.setItem(SELECTED_FOLDER_KEY, folder);
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
}
