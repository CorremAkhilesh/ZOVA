import { Pin, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { authErrorMessage } from '@/features/auth/errors';
import { useLocalDb } from '@/features/chats/queries';
import { useUnexpiredPins } from '@/features/disappearing/use-unexpired-pins';
import { toPlainText } from '@/features/formatting/parse';
import { useMessageUi } from '@/features/messages/store';
import type { ChatRow } from '@/features/sync/local-db';
import { useLive } from '@/features/sync/use-live';
import { PinDialog } from './PinDialog';
import { canPin, livePins, pinsApi, storePins } from './pins';

/** Pins run out on their own: look again every minute. */
const RECHECK_MS = 60_000;

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), RECHECK_MS);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * Under the chat's header: the newest pin first. Tapping jumps to that message (loading older ones
 * if needed) and moves on to the next pin, so repeated taps go through them all.
 */
export function PinnedBar({ chat }: { chat: ChatRow }) {
  const { t } = useTranslation();
  const db = useLocalDb();
  const now = useNow();
  const pins = useUnexpiredPins(chat.id, livePins(chat.pins, now));
  const [index, setIndex] = useState(0);
  const shown = pins[Math.min(index, Math.max(0, pins.length - 1))];
  const text = useLive(async () => {
    if (!db || !shown) return null;
    const row = await db.messages.where('[chatId+order]').equals([chat.id, shown.seq]).first();
    return row ? toPlainText(row.text ?? '') : null;
  }, [db, chat.id, shown?.seq]);
  const allowed = canPin(chat);
  return (
    <>
      <PinDialog chat={chat} />
      {shown ? (
        <div className="glass flex items-center gap-2 border-b px-3 py-1.5">
          <button
            type="button"
            onClick={() => {
              useMessageUi.getState().set({ jump: { chatId: chat.id, seq: shown.seq } });
              setIndex((index + 1) % pins.length);
            }}
            aria-label={t('pins.open', {
              current: Math.min(index, pins.length - 1) + 1,
              total: pins.length,
            })}
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
          >
            <span className="flex flex-col gap-0.5" aria-hidden>
              {pins.map((pin, position) => (
                <span
                  key={pin.messageId}
                  className={
                    position === index % pins.length ? 'h-2 w-0.5 bg-brand' : 'h-2 w-0.5 bg-border'
                  }
                />
              ))}
            </span>
            <Pin className="size-4 shrink-0 rotate-45 text-brand-text" aria-hidden />
            <span className="min-w-0">
              <span className="block text-xs font-medium text-brand-text">
                {pins.length > 1
                  ? t('pins.counter', { current: (index % pins.length) + 1, total: pins.length })
                  : t('pins.title')}
              </span>
              <span className="block truncate text-sm">{text || t('pins.fallback')}</span>
            </span>
          </button>
          {allowed ? (
            <button
              type="button"
              aria-label={t('pins.unpin')}
              onClick={() =>
                void pinsApi
                  .unpin(chat.id, shown.messageId)
                  .then(({ pins: next }) => storePins(db, chat.id, next))
                  .catch((error: unknown) => toast.error(authErrorMessage(error, t)))
              }
              className="rounded-full p-1 text-text-muted hover:text-text"
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
