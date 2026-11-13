import { useEffect } from 'react';
import { useMessageUi } from '@/features/messages/store';

/** The header button that opens chat info: focus goes back to it when the pane closes. */
export const INFO_TOGGLE_ATTR = 'data-info-toggle';

export function focusInfoToggle(): void {
  requestAnimationFrame(() => {
    document.querySelector<HTMLElement>(`[${INFO_TOGGLE_ATTR}]`)?.focus();
  });
}

/**
 * Desktop chat info pane: Esc closes it before it closes the chat. Order, innermost first:
 * dialogs and menus (Radix marks the event), a reply / edit / selection (useChatShortcuts), then
 * this pane, then the chat. Listens on `document`, which hears the key before `window` does.
 */
export function useInfoPaneEscape(open: boolean, chatId: string, onClose: () => void): void {
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const ui = useMessageUi.getState();
      if (ui.selecting || ui.editing || ui.replies[chatId]) return;
      event.preventDefault();
      const hadFocus = document.activeElement?.closest('[data-info-pane]') !== null;
      onClose();
      if (hadFocus) focusInfoToggle();
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, chatId, onClose]);
}
