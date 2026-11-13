import { type KeyboardEvent, type MouseEvent, type TouchEvent, useRef, useState } from 'react';
import { useSession } from '@/features/auth/session';
import type { ChatMessage } from '@/features/chats/types';
import { canAct, toQuote } from './rules';
import { useMessageUi } from './store';

const LONG_PRESS_MS = 500;
const MOVE_SLOP_PX = 10;
const SWIPE_REPLY_PX = 56;
const SWIPE_MAX_PX = 72;

/** Right click, long press, swipe to reply, R to reply, and picking while selecting. */
export function useBubbleGestures(message: ChatMessage, items: ChatMessage[]) {
  const session = useSession();
  const [swipe, setSwipe] = useState(0);
  const press = useRef<{ x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null);
  const usable = canAct(message);

  const openMenu = (x: number, y: number) => {
    useMessageUi.getState().set({ menu: { message, items, x, y } });
  };
  const reply = () => {
    const quote = toQuote(message, session?.user.id ?? '', session?.user.displayName ?? '');
    if (quote) useMessageUi.getState().setReply(message.chatId, quote);
  };
  const endPress = () => {
    if (press.current) clearTimeout(press.current.timer);
    press.current = null;
  };

  return {
    swipe,
    reply,
    openMenu,
    handlers: usable
      ? {
          onContextMenu(event: MouseEvent) {
            event.preventDefault();
            openMenu(event.clientX, event.clientY);
          },
          onClick() {
            const { selecting, toggleSelected } = useMessageUi.getState();
            if (selecting) for (const item of items) toggleSelected(item);
          },
          onKeyDown(event: KeyboardEvent) {
            if (event.target !== event.currentTarget) return;
            if (event.key.toLowerCase() === 'r') {
              event.preventDefault();
              reply();
            }
          },
          onTouchStart(event: TouchEvent) {
            const touch = event.touches[0];
            if (!touch) return;
            const { clientX: x, clientY: y } = touch;
            const timer = setTimeout(() => {
              press.current = null;
              setSwipe(0);
              openMenu(x, y);
            }, LONG_PRESS_MS);
            press.current = { x, y, timer };
          },
          onTouchMove(event: TouchEvent) {
            const touch = event.touches[0];
            if (!touch || !press.current) return;
            const dx = touch.clientX - press.current.x;
            const dy = touch.clientY - press.current.y;
            if (Math.abs(dx) > MOVE_SLOP_PX || Math.abs(dy) > MOVE_SLOP_PX) {
              clearTimeout(press.current.timer);
            }
            // Sideways and to the right only: scrolling up and down stays what it is.
            if (Math.abs(dy) < MOVE_SLOP_PX * 2) {
              setSwipe(Math.max(0, Math.min(dx, SWIPE_MAX_PX)));
            }
          },
          onTouchEnd() {
            if (swipe >= SWIPE_REPLY_PX) reply();
            setSwipe(0);
            endPress();
          },
          onTouchCancel() {
            setSwipe(0);
            endPress();
          },
        }
      : {},
  };
}
