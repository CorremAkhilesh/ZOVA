import { SendHorizontal } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import type { ScheduleDraft } from './ScheduleDialog';
import { ScheduleMenu } from './ScheduleMenu';

const ScheduleDialog = lazy(() => import('./ScheduleDialog'));

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
  const [draft, setDraft] = useState<ScheduleDraft | null>(null);

  return (
    <>
      <ScheduleMenu
        available={() => !disabled && takeDraft() !== null}
        onSchedule={() => setDraft(takeDraft())}
      >
        {(trigger) => (
          <Button
            type="submit"
            size="icon"
            className="rounded-full"
            disabled={disabled}
            aria-label={t('conversation.send')}
            {...trigger}
          >
            <SendHorizontal className="size-5" />
          </Button>
        )}
      </ScheduleMenu>
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
