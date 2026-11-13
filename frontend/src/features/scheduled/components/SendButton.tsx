import { Clock, SendHorizontal } from 'lucide-react';
import { Popover } from 'radix-ui';
import { lazy, type MouseEvent, Suspense, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { ScheduleDraft } from './ScheduleDialog';

const ScheduleDialog = lazy(() => import('./ScheduleDialog'));

const LONG_PRESS_MS = 500;

interface SendButtonProps {
  chatId: string;
  disabled: boolean;
  /** What would be sent now; null where scheduling makes no sense (editing a message). */
  takeDraft: () => ScheduleDraft | null;
  /** Scheduled: the composer empties, as after sending. */
  onScheduled: () => void;
}

/**
 * The composer's Send button. Right click, or a long press on a touch screen, offers "Schedule
 * message" instead (the context-menu key does the same from the keyboard).
 */
export function SendButton({ chatId, disabled, takeDraft, onScheduled }: SendButtonProps) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState(false);
  const [draft, setDraft] = useState<ScheduleDraft | null>(null);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pressed = useRef(false);

  const offer = () => {
    if (!disabled && takeDraft()) setMenu(true);
  };
  const endPress = () => {
    if (press.current) clearTimeout(press.current);
    press.current = null;
  };

  return (
    <>
      <Popover.Root open={menu} onOpenChange={setMenu}>
        <Popover.Anchor asChild>
          <Button
            type="submit"
            size="icon"
            className="rounded-full"
            disabled={disabled}
            aria-label={t('conversation.send')}
            onContextMenu={(event) => {
              event.preventDefault();
              offer();
            }}
            onTouchStart={() => {
              pressed.current = false;
              endPress();
              press.current = setTimeout(() => {
                pressed.current = true;
                offer();
              }, LONG_PRESS_MS);
            }}
            onTouchEnd={endPress}
            onTouchMove={endPress}
            onClick={(event: MouseEvent) => {
              // The tap that ends a long press must not also send.
              if (!pressed.current) return;
              pressed.current = false;
              event.preventDefault();
            }}
          >
            <SendHorizontal className="size-5" />
          </Button>
        </Popover.Anchor>
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
                setDraft(takeDraft());
              }}
            >
              <Clock className="size-5 text-brand-text" aria-hidden />
              {t('scheduled.scheduleMessage')}
            </button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {draft ? (
        <Suspense fallback={null}>
          <ScheduleDialog
            mode="create"
            chatId={chatId}
            draft={draft}
            onDone={onScheduled}
            onClose={() => setDraft(null)}
          />
        </Suspense>
      ) : null}
    </>
  );
}
