import { Clock } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { useChatScheduled } from '../api';

const ScheduledSheet = lazy(() => import('./ScheduledSheet'));

/** In the chat header, only while this chat has scheduled messages: opens their list. */
export function ScheduledButton({ chatId }: { chatId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const count = useChatScheduled(chatId).data?.length ?? 0;
  return (
    <>
      {count > 0 ? (
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('scheduled.headerButton', { count })}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          className="relative"
        >
          <Clock className="size-5" />
          <span
            aria-hidden
            className="absolute top-1 right-1 min-w-4 rounded-full bg-brand px-1 text-[10px] leading-4 font-semibold text-brand-foreground tabular-nums"
          >
            {count}
          </span>
        </Button>
      ) : null}
      {open ? (
        <Suspense fallback={null}>
          <ScheduledSheet chatId={chatId} onClose={() => setOpen(false)} />
        </Suspense>
      ) : null}
    </>
  );
}
