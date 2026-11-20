import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { type KeyboardEvent, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useModeration } from '@/features/moderation/store';
import { cn } from '@/lib/utils';
import { markViewed } from '../actions';
import { useStatusFeed } from '../feed';
import { DeleteStatusDialog } from './DeleteStatusDialog';
import { durationOf, nextPosition, previousPosition, useStatusViewer } from './queue';
import { Preload, StatusBackdrop, StatusContent } from './StatusContent';
import { useStatusClock } from './use-status-clock';
import { usePageHidden, useViewerGestures } from './use-viewer-gestures';
import { VIEWER_ICON_BUTTON, ViewerHeader } from './ViewerChrome';
import { OwnFooter, ReplyFooter } from './ViewerFooter';
import { ViewersSheet } from './ViewersSheet';

const ARROW =
  'absolute top-1/2 z-20 hidden size-14 -translate-y-1/2 place-items-center rounded-full bg-white/12 text-white backdrop-blur hover:bg-white/25 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-white/70 md:grid';

/** Statuses deleted or expired anywhere (the feed no longer has them) leave the open viewer too. */
function useFollowFeed() {
  const feed = useStatusFeed();
  const keepOnly = useStatusViewer((state) => state.keepOnly);
  useEffect(() => {
    if (!feed) return;
    const alive = new Set([
      ...feed.mine.map((status) => status.id),
      ...feed.people.flatMap((person) => person.statuses.map((status) => status.id)),
    ]);
    keepOnly((status) => alive.has(status.id));
  }, [feed, keepOnly]);
}

/**
 * The whole window, one status at a time, progress bars on top. Phone: tap right for the next,
 * left for the one before, hold to pause, swipe down to close, swipe up to reply (or, mine, to see
 * who viewed it). Wider screens: the picture large in the middle, ‹ › on the sides, ✕ in the
 * corner, the reply box under it. ← → and Esc on a keyboard. ⋯, a dialog or typing pauses it.
 */
export function StatusViewer() {
  const { t } = useTranslation();
  const { queue, at, go, close } = useStatusViewer();
  const person = queue?.[at.person];
  const status = person?.statuses[at.status];
  const [typing, setTyping] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);
  const [sheet, setSheet] = useState<'viewers' | 'delete' | null>(null);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [videoSeconds, setVideoSeconds] = useState<number | undefined>(undefined);
  const reporting = useModeration((state) => state.report !== null || state.confirmBlock !== null);
  const hidden = usePageHidden();
  useFollowFeed();

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
  const swipeUp = useCallback(
    () => (person?.mine ? setSheet('viewers') : setReplyOpen(true)),
    [person?.mine],
  );
  // A tap with the phone's reply box open closes the box; otherwise it moves.
  const tap = (side: 'left' | 'right') => {
    if (replyOpen) setReplyOpen(false);
    else if (side === 'left') previous();
    else next();
  };
  const gestures = useViewerGestures({ tap, close, swipeUp });

  const key = status?.id ?? 'none';
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new status starts with no length, no wait, reply closed
  useEffect(() => {
    setVideoSeconds(undefined);
    setWaiting(false);
    setReplyOpen(false);
  }, [key]);
  useEffect(() => {
    if (status && person && !person.mine) markViewed(status);
  }, [status, person]);

  const paused =
    gestures.holding ||
    typing ||
    waiting ||
    hidden ||
    menuOpen ||
    replyOpen ||
    reporting ||
    sheet !== null;
  const progress = useStatusClock({
    key,
    durationMs: status ? durationOf(status, videoSeconds) : 1,
    paused: paused || !status,
    onDone: next,
  });
  if (!queue || !person || !status) return null;
  const upcoming = nextPosition(queue, at);
  const preload = upcoming ? queue[upcoming.person]?.statuses[upcoming.status] : undefined;
  const earlier = previousPosition(queue, at);

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
        <DialogPrimitive.Overlay className="fixed inset-0 z-[1600] bg-[#0b0b12]" />
        <DialogPrimitive.Content
          ref={setRoot}
          aria-describedby={undefined}
          onKeyDown={onKeyDown}
          className="fixed inset-0 z-[1600] overflow-hidden bg-[#0b0b12] text-white outline-none"
        >
          <DialogPrimitive.Title className="sr-only">
            {t(person.mine ? 'updates.myStatus' : 'updates.statusOf', {
              name: person.user.displayName,
            })}
          </DialogPrimitive.Title>
          <StatusBackdrop status={status} />
          <button
            type="button"
            aria-label={t('updates.close')}
            className={cn(VIEWER_ICON_BUTTON, 'absolute top-4 right-4 z-20 hidden md:grid')}
            onClick={close}
          >
            <X className="size-7" aria-hidden />
          </button>
          {earlier ? (
            <button
              type="button"
              aria-label={t('updates.previous')}
              className={cn(ARROW, 'left-4 lg:left-8')}
              onClick={previous}
            >
              <ChevronLeft className="size-8" aria-hidden />
            </button>
          ) : null}
          <button
            type="button"
            aria-label={t('updates.next')}
            className={cn(ARROW, 'right-4 lg:right-8')}
            onClick={next}
          >
            <ChevronRight className="size-8" aria-hidden />
          </button>
          {/* The column: the whole screen on a phone, a wide centred stage on larger screens. */}
          <div className="relative mx-auto flex h-full w-full flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] md:w-[min(calc(100%-10rem),40rem)] md:py-4 lg:w-[min(calc(100%-14rem),46rem)] xl:w-[52rem]">
            <div className="absolute inset-x-0 top-[env(safe-area-inset-top)] z-10 md:relative md:top-0">
              <ViewerHeader
                person={person}
                status={status}
                index={at.status}
                progress={progress}
                menuOpen={menuOpen}
                container={root}
                onMenu={setMenuOpen}
                onDelete={() => setSheet('delete')}
                onClose={close}
              />
            </div>
            {/* The picture: taps, holds and swipes. The buttons live outside it. */}
            <div
              role="presentation"
              data-testid="status-stage"
              className="absolute inset-0 touch-none select-none md:relative md:inset-auto md:min-h-0 md:flex-1"
              {...gestures.handlers}
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
            <div className="absolute inset-x-0 bottom-[env(safe-area-inset-bottom)] z-10 bg-gradient-to-t from-black/70 via-black/35 to-transparent px-3 pt-8 pb-3 md:relative md:bottom-0 md:bg-none md:pt-4 md:pb-0">
              {person.mine ? (
                <OwnFooter status={status} onViewers={() => setSheet('viewers')} />
              ) : (
                <ReplyFooter
                  owner={person.user}
                  status={status}
                  open={replyOpen}
                  onOpen={setReplyOpen}
                  onTyping={setTyping}
                />
              )}
            </div>
          </div>
          {sheet === 'viewers' ? (
            <ViewersSheet statusId={status.id} onClose={() => setSheet(null)} />
          ) : null}
          {sheet === 'delete' ? (
            <DeleteStatusDialog status={status} onClose={() => setSheet(null)} />
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
