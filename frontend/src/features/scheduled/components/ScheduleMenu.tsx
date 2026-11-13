import { Clock } from 'lucide-react';
import { Popover } from 'radix-ui';
import { type MouseEvent, type ReactElement, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const LONG_PRESS_MS = 500;

/** Spread onto the send button: right click and a long press open the menu. */
export interface ScheduleTriggerProps {
  onContextMenu: (event: MouseEvent) => void;
  onTouchStart: () => void;
  onTouchEnd: () => void;
  onTouchMove: () => void;
  onClick: (event: MouseEvent) => void;
}

interface ScheduleMenuProps {
  /** False: the button only sends (nothing to schedule, or not allowed now). */
  available: () => boolean;
  /** "Schedule message" picked. */
  onSchedule: () => void;
  /** The send button, given the props that open the menu. Its own click still sends. */
  children: (trigger: ScheduleTriggerProps) => ReactElement;
}

/**
 * A send button's "Schedule message" menu: right click, or a long press on a touch screen (the
 * context-menu key does the same from the keyboard). Shared by text, files and voice notes.
 */
export function ScheduleMenu({ available, onSchedule, children }: ScheduleMenuProps) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState(false);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressed = useRef(false);

  const offer = () => {
    if (available()) setMenu(true);
  };
  const endPress = () => {
    if (press.current) clearTimeout(press.current);
    press.current = null;
  };

  const trigger: ScheduleTriggerProps = {
    onContextMenu: (event) => {
      event.preventDefault();
      offer();
    },
    onTouchStart: () => {
      pressed.current = false;
      endPress();
      press.current = setTimeout(() => {
        pressed.current = true;
        offer();
      }, LONG_PRESS_MS);
    },
    onTouchEnd: endPress,
    onTouchMove: endPress,
    onClick: (event) => {
      // The tap that ends a long press must not also send.
      if (!pressed.current) return;
      pressed.current = false;
      event.preventDefault();
    },
  };

  return (
    <Popover.Root open={menu} onOpenChange={setMenu}>
      <Popover.Anchor asChild>{children(trigger)}</Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={8}
          aria-label={t('scheduled.sendOptions')}
          className="z-[1500] w-56 rounded-xl border bg-surface p-1.5 shadow-lg"
        >
          <button
            type="button"
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-background"
            onClick={() => {
              setMenu(false);
              onSchedule();
            }}
          >
            <Clock className="size-5 text-brand-text" aria-hidden />
            {t('scheduled.scheduleMessage')}
          </button>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
