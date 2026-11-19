import { toast } from 'sonner';
import type { ChatMessage, ChatSummary } from '@/features/chats/types';
import { useSyncStore } from '@/features/sync/store';
import { i18n } from '@/lib/i18n';
import { deletesAsAdmin, targetOf } from './rules';
import { useMessageUi } from './store';

/** How long "Undo" is offered after "Delete for me". */
export const UNDO_MS = 5000;

const hide = (ids: string[]) =>
  useMessageUi.setState((state) => ({ hidden: [...new Set([...state.hidden, ...ids])] }));
const unhide = (ids: string[]) =>
  useMessageUi.setState((state) => ({ hidden: state.hidden.filter((id) => !ids.includes(id)) }));

/**
 * Never sent: only this device has them. The outbox row, the local copy and its file go, and an
 * upload the server had started is cancelled. Nobody else ever saw them, so there is nothing more.
 */
export function discardUnsent(messages: ChatMessage[]): void {
  const { client } = useSyncStore.getState();
  for (const message of messages) {
    if (message.clientMsgId) void client?.cancelMedia(message.clientMsgId);
  }
}

/** Everyone sees "This message was deleted"; the server checks the 48 hours and admin rights again. */
export function deleteForEveryone(messages: ChatMessage[], chat: ChatSummary): void {
  const { client } = useSyncStore.getState();
  for (const message of messages) {
    void client?.act({
      type: 'delete',
      ...targetOf(message),
      scope: 'everyone',
      ...(deletesAsAdmin(message, chat) ? { asAdmin: true } : {}),
    });
  }
}

/**
 * Gone from this chat at once, with "Undo" for five seconds; only then is it deleted for me (on all
 * my devices). Leaving the page in those seconds deletes it straight away rather than losing it.
 */
export function deleteForMeWithUndo(messages: ChatMessage[]): void {
  const ids = messages.map((message) => message.id);
  hide(ids);
  let settled = false;
  const commit = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    window.removeEventListener('pagehide', commit);
    const { client } = useSyncStore.getState();
    const sent = messages.map((message) =>
      client?.act({ type: 'delete', ...targetOf(message), scope: 'me' }),
    );
    // Shown again only once the local copy is gone, so nothing flickers back.
    void Promise.allSettled(sent).then(() => unhide(ids));
  };
  const undo = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    window.removeEventListener('pagehide', commit);
    unhide(ids);
  };
  const timer = setTimeout(commit, UNDO_MS);
  window.addEventListener('pagehide', commit);
  toast(i18n.t('messages.deletedForMe', { count: messages.length }), {
    duration: UNDO_MS,
    action: { label: i18n.t('messages.undo'), onClick: undo },
  });
}
