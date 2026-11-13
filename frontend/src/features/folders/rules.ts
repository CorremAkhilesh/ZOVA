import type { ChatFolderDef } from '@zuvo/protocol';
import type { ChatFolder, ChatSummary } from '@/features/chats/types';

export type FolderChat = Pick<
  ChatSummary,
  'id' | 'kind' | 'unread' | 'markedUnread' | 'muted' | 'archived'
>;

/** Something unread in it: new messages, or marked unread by hand. */
export const isUnread = (chat: Pick<ChatSummary, 'unread' | 'markedUnread'>) =>
  chat.unread > 0 || chat.markedUnread === true;

/**
 * Whether a chat is in one of my folders. Picked chats are always in; the rules take in more,
 * minus the muted or archived ones when the folder leaves those out.
 */
export function chatInFolder(chat: FolderChat, folder: ChatFolderDef): boolean {
  if (folder.chatIds.includes(chat.id)) return true;
  const { rules } = folder;
  const matches =
    (rules.groups && chat.kind === 'group') ||
    (rules.direct && chat.kind === 'personal') ||
    (rules.unread && isUnread(chat));
  if (!matches) return false;
  if (rules.excludeMuted && chat.muted) return false;
  if (rules.excludeArchived && chat.archived === true) return false;
  return true;
}

export const folderKey = (id: string): ChatFolder => `folder:${id}`;

/** The folder a chip stands for, or undefined for a built-in chip (or a folder that is gone). */
export function customFolder(
  folder: ChatFolder,
  folders: readonly ChatFolderDef[] | undefined,
): ChatFolderDef | undefined {
  if (!folder.startsWith('folder:')) return undefined;
  const id = folder.slice('folder:'.length);
  return folders?.find((item) => item.id === id);
}

/** The chip to show: a deleted folder falls back to All, once my folders are known. */
export function resolveFolder(
  folder: ChatFolder,
  folders: readonly ChatFolderDef[] | undefined,
): ChatFolder {
  if (!folder.startsWith('folder:') || folders === undefined) return folder;
  return customFolder(folder, folders) ? folder : 'all';
}

/** The chip label: emoji and name. */
export const folderLabel = (folder: Pick<ChatFolderDef, 'emoji' | 'name'>) =>
  folder.emoji ? `${folder.emoji} ${folder.name}` : folder.name;
