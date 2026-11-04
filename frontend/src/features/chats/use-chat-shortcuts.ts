import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useIsDesktop } from '@/lib/hooks';
import { useNewChat } from './new-chat-store';

/**
 * Ctrl/Cmd+N: new chat. Esc: close the open chat on desktop. Dialogs and popovers handle Esc first
 * and mark the event, so it closes only them. Browser tabs may keep Ctrl+N for a new window; the
 * installed app gets it.
 */
export function useChatShortcuts(chatOpen: boolean): void {
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const open = useNewChat((state) => state.open);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('new')) open();
  }, [open]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const command = event.ctrlKey || event.metaKey;
      if (command && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        open();
      } else if (event.key === 'Escape' && !event.defaultPrevented && isDesktop && chatOpen) {
        void navigate({ to: '/chats' });
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [chatOpen, isDesktop, navigate, open]);
}
