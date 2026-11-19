import { Dialog as DialogPrimitive } from 'radix-ui';
import {
  type KeyboardEvent,
  type PointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { markViewed } from '../actions';
import { durationOf, nextPosition, previousPosition, useStatusViewer } from './queue';
import { Preload, StatusContent } from './StatusContent';
import { useStatusClock } from './use-status-clock';
import { DeleteStatusDialog, ViewerHeader } from './ViewerChrome';
import { OwnFooter, ReplyFooter } from './ViewerFooter';
import { ViewersSheet } from './ViewersSheet';

const TAP_MS = 300;
const SLOP_PX = 20;
const SWIPE_CLOSE_PX = 80;

/** Whether the page is hidden (another tab, the phone locked): the status waits. */
function usePageHidden() {
  const [hidden, setHidden] = useState(() => document.visibilityState === 'hidden');
  useEffect(() => {
    const update = () => setHidden(document.visibilityState === 'hidden');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return hidden;
}

/**
 * Full screen, one status at a time with progress bars on top. Tap right for the next, left for the
 * one before; hold to pause; swipe down to close. ← → and Esc on a keyboard. After someone's last
 * status the next person's begin, and the next status's file is fetched ahead.
 */
export function StatusViewer() {
  const { t } = useTranslation();
  const { queue, at, go, close } = useStatusViewer();
  const person = queue?.[at.person];
  const status = person?.statuses[at.status];
  const [holding, setHolding] = useState(false);
  const [typing, setTyping] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [sheet, setSheet] = useState<'viewers' | 'delete' | 'menu' | null>(null);
  const [videoSeconds, setVideoSeconds] = useState<number | undefined>(undefined);
  const hidden = usePageHidden();
  const press = useRef<{ x: number; y: number; at: number } | null>(null);

  const next = useCallback(() => {
    if (!queue) return;
    const position = nextPosition(queue, at);
    if (position) go(position);
    else close();
  }, [queue, at, go, close]);
  const previous = useCallback(() => {
    if (!queue) return;
    const position = previousPosition(queue, at);
    if (position) go(position);
  }, [queue, at, go]);

  const key = status?.id ?? 'none';
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new status starts with no length and no wait
  useEffect(() => {
    setVideoSeconds(undefined);
    setWaiting(false);
  }, [key]);
  useEffect(() => {
    if (status && person && !person.mine) markViewed(status);
  }, [status, person]);

  const paused = holding || typing || waiting || hidden || sheet !== null;
  const progress = useStatusClock({
    key,
    durationMs: status ? durationOf(status, videoSeconds) : 1,
    paused: paused || !status,
    onDone: next,
  });
  if (!queue || !person || !status) return null;
  const upcoming = nextPosition(queue, at);
  const preload = upcoming ? queue[upcoming.person]?.statuses[upcoming.status] : undefined;

  const onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    press.current = { x: event.clientX, y: event.clientY, at: Date.now() };
    setHolding(true);
  };
  const onPointerUp = (event: PointerEvent) => {
    const start = press.current;
    press.current = null;
    setHolding(false);
    if (!start) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (dy > SWIPE_CLOSE_PX && Math.abs(dy) > Math.abs(dx)) {
      close();
      return;
    }
    if (Date.now() - start.at > TAP_MS || Math.abs(dx) > SLOP_PX || Math.abs(dy) > SLOP_PX) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (event.clientX - box.left < box.width / 3) previous();
    else next();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.target as HTMLElement).tagName === 'INPUT') return;
    if (event.key === 'ArrowRight') next();
    else if (event.key === 'ArrowLeft') previous();
    else return;
    event.preventDefault();
  };

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => (open ? undefined : close())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[1600] bg-black" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          className="fixed inset-0 z-[1600] flex flex-col bg-black pt-[env(safe-area-inset-top)] pb-[max(0.75rem,env(safe-area-inset-bottom))] text-white outline-none md:inset-y-4 md:left-1/2 md:w-[min(28rem,100vw)] md:-translate-x-1/2 md:overflow-hidden md:rounded-2xl"
        >
          <DialogPrimitive.Title className="sr-only">
            {t(person.mine ? 'updates.myStatus' : 'updates.statusOf', {
              name: person.user.displayName,
            })}
          </DialogPrimitive.Title>
          <ViewerHeader
            person={person}
            status={status}
            index={at.status}
            progress={progress}
            onMenu={(open) => setSheet(open ? 'menu' : null)}
            onDelete={() => setSheet('delete')}
            onClose={close}
          />
          {/* The picture area: taps, holds and swipes. The buttons live outside it. */}
          <div
            role="presentation"
            className="relative min-h-0 flex-1 touch-none select-none"
            onPointerDown={onPointerDown}
            onPointerUp={onPointerUp}
            onPointerCancel={() => {
              press.current = null;
              setHolding(false);
            }}
          >
            <StatusContent
              status={status}
              paused={paused}
              onVideoLength={setVideoSeconds}
              onWaiting={setWaiting}
            />
            <Preload status={preload} />
            <p className="sr-only" aria-live="polite">
              {t('updates.position', { index: at.status + 1, count: person.statuses.length })}
            </p>
          </div>
          <div className="px-3 pt-3">
            {person.mine ? (
              <OwnFooter
                status={status}
                onViewers={() => setSheet('viewers')}
                onDelete={() => setSheet('delete')}
              />
            ) : (
              <ReplyFooter owner={person.user} status={status} onTyping={setTyping} />
            )}
          </div>
          {sheet === 'viewers' ? (
            <ViewersSheet statusId={status.id} onClose={() => setSheet(null)} />
          ) : null}
          {sheet === 'delete' ? (
            <DeleteStatusDialog status={status} onClose={() => setSheet(null)} onDeleted={next} />
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
