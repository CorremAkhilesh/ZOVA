import type { DisappearTimer } from '@zuvo/protocol';
import { ChevronRight, Timer } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useLocalDb } from '@/features/chats/queries';
import type { ChatRow, LocalDb } from '@/features/sync/local-db';
import { disappearingApi } from './api';
import { TIMERS, timerAccess, timerLabel, timerOf } from './rules';

/** Shown at once; put back if the server says no. The server's system message follows by sync. */
export async function changeTimer(
  db: LocalDb | null,
  chatId: string,
  previous: DisappearTimer,
  next: DisappearTimer,
): Promise<boolean> {
  await db?.chats.update(chatId, { disappearing: next }).catch(() => undefined);
  try {
    const { timer } = await disappearingApi.set(chatId, next);
    await db?.chats.update(chatId, { disappearing: timer }).catch(() => undefined);
    return true;
  } catch {
    await db?.chats.update(chatId, { disappearing: previous }).catch(() => undefined);
    return false;
  }
}

function TimerDialog(props: { chat: ChatRow; canChange: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const db = useLocalDb();
  const { chat, canChange, onClose } = props;
  const current = timerOf(chat);
  const pick = (next: DisappearTimer) => {
    if (next === current) return;
    void changeTimer(db, chat.id, current, next).then((ok) => {
      if (!ok) toast.error(t('disappearing.failed'));
    });
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent
        title={t('disappearing.title')}
        description={canChange ? t('disappearing.hint') : t('disappearing.adminsOnly')}
        className="max-w-sm"
      >
        <fieldset className="space-y-2" disabled={!canChange}>
          <legend className="sr-only">{t('disappearing.title')}</legend>
          {TIMERS.map((value) => (
            <label key={value} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="disappearing-timer"
                value={value}
                checked={current === value}
                onChange={() => pick(value)}
                className="accent-brand"
              />
              {timerLabel(value, t)}
            </label>
          ))}
        </fieldset>
      </DialogContent>
    </Dialog>
  );
}

/** "Disappearing messages · 7 days" in chat info; opens the choice. Not in Saved Messages. */
export function DisappearingRow({ chat }: { chat: ChatRow }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const access = timerAccess(chat);
  if (access === 'hidden') return null;
  const value = timerLabel(timerOf(chat), t);
  return (
    <div className="px-4 py-2">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${t('disappearing.title')}: ${value}`}
        className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-sm hover:bg-background"
      >
        <Timer className="size-4 shrink-0 text-text-muted" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{t('disappearing.title')}</span>
          <span className="block text-xs text-text-muted">{value}</span>
        </span>
        <ChevronRight className="size-4 text-text-muted" aria-hidden />
      </button>
      {open ? (
        <TimerDialog chat={chat} canChange={access === 'change'} onClose={() => setOpen(false)} />
      ) : null}
    </div>
  );
}
