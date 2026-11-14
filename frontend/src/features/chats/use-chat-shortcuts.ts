import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useMessageUi } from '@/features/messages/store';
import { useBackClose } from '@/lib/back-stack';
import { useIsDesktop } from '@/lib/hooks';
import { useNewChat } from './new-chat-store';

/**
 * Ctrl/Cmd+N: new chat. Esc: cancel a reply, edit or selection, or else close the open chat on desktop. Dialogs and popovers handle Esc first
 * and mark the event, so it closes only them. Browser tabs may keep Ctrl+N for a new window; the
 * installed app gets it.
 */
function cancelInProgress(event: KeyboardEvent, chatId: string | undefined) {
  const cancelled = useMessageUi.getState().cancelOne(chatId);
  if (cancelled) event.preventDefault();
  return cancelled;
}

export function useChatShortcuts(openChatId: string | undefined): void {
  const chatOpen = openChatId !== undefined;
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const open = useNewChat((state) => state.open);
  // Back cancels them one by one too, before it leaves the chat (see back-stack.ts).
  const inProgress = useMessageUi(
    (state) =>
      state.selecting !== null ||
      state.editing !== null ||
      Boolean(openChatId && state.replies[openChatId]),
  );
  useBackClose(inProgress, () => useMessageUi.getState().cancelOne(openChatId));

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('new')) open();
  }, [open]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const command = event.ctrlKey || event.metaKey;
      if (command && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        open();
      } else if (
        event.key === 'Escape' &&
        !event.defaultPrevented &&
        !cancelInProgress(event, openChatId)
      ) {
        if (isDesktop && chatOpen) void navigate({ to: '/chats' });
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [chatOpen, isDesktop, navigate, open, openChatId]);
}
