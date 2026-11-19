/**
 * Where picked files for a chat go: its preview sheet (`useSendMedia` registers it while the chat is
 * open). "Choose again" on a file that is no longer on this device sends the new pick there.
 */
type FileTarget = (files: File[]) => void;

const targets = new Map<string, FileTarget>();

/** Registers `target` for `chatId`; the returned function removes it again. */
export function setFileTarget(chatId: string, target: FileTarget): () => void {
  targets.set(chatId, target);
  return () => {
    if (targets.get(chatId) === target) targets.delete(chatId);
  };
}

export const fileTargetFor = (chatId: string): FileTarget | undefined => targets.get(chatId);
