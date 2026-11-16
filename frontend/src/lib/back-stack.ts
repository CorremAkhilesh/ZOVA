import { type RouterHistory, useRouter } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

/**
 * The phone's back gesture (or the browser's Back) closes the top-most menu, sheet, dialog or
 * viewer before it leaves the screen, in the same order as Esc: whatever opened last closes first.
 *
 * Each open overlay adds one history entry: the same URL, so the route stays as it is, marked in
 * its state. Back lands on the entry below, and every overlay whose entry was above it closes.
 * An overlay closed another way (Esc, its X, a choice in a menu) takes its own entry back out, so
 * Back never stops at a dead entry. If something else was pushed on top of it in the meantime (a
 * menu choice that opened another chat), the entry stays: one extra Back press, never a lost route.
 *
 * Only on phones and touch screens. A desktop with a mouse has Esc, and its Back keeps meaning
 * "the previous page".
 */
export const BACK_STACK_QUERY = '(max-width: 767px), (pointer: coarse)';

const MARKER = 'zuvoOverlay';
/** The scroll-restoration key of the page under the overlays. */
const BASE_KEY = 'zuvoOverlayBase';
const INDEX = '__TSR_index';
/** In case the browser never reports a Back (it always should). */
const POP_TIMEOUT_MS = 1000;

interface Entry {
  id: number;
  /** Its position in history once pushed. */
  index: number | null;
  /** Its history entry is gone, or was never wanted. */
  done: boolean;
  onBack: () => void;
}

interface Tracker {
  history: RouterHistory;
  stack: Entry[];
  tail: Promise<void>;
  popped: (() => void) | null;
}

let tracker: Tracker | null = null;
let nextId = 1;

type Location = RouterHistory['location'];
const stateOf = (location: Location) => location.state as unknown as Record<string, unknown>;
const indexOf = (location: Location) => Number(stateOf(location)[INDEX] ?? 0);

/** Overlay entries share the key of the page under them, so opening one never moves its scroll. */
export function scrollKeyOf(location: { state: object; href: string }): string {
  const state = location.state as Record<string, unknown>;
  const base = state[BASE_KEY] ?? state.__TSR_key;
  return typeof base === 'string' && base ? base : location.href;
}

function trackerFor(history: RouterHistory): Tracker {
  if (tracker?.history === history) return tracker;
  const next: Tracker = { history, stack: [], tail: Promise.resolve(), popped: null };
  history.subscribe(({ action }) => {
    next.popped?.();
    next.popped = null;
    if (action.type === 'PUSH' || action.type === 'REPLACE') return;
    const at = indexOf(history.location);
    const closing = next.stack.filter((entry) => entry.index !== null && entry.index > at);
    next.stack = next.stack.filter((entry) => !closing.includes(entry));
    // Top-most first, as Esc would.
    for (const entry of closing.reverse()) {
      entry.done = true;
      entry.onBack();
    }
  });
  tracker = next;
  return next;
}

/** One history change at a time: a Back has to land before the next entry goes on. */
function run(current: Tracker, task: () => void | Promise<void>) {
  current.tail = current.tail.then(task).catch(() => undefined);
}

function pushEntry(current: Tracker, onBack: () => void): Entry {
  const entry: Entry = { id: nextId++, index: null, done: false, onBack };
  current.stack.push(entry);
  run(current, () => {
    if (entry.done) return;
    const { history } = current;
    const below = history.location;
    history.push(below.href, { [MARKER]: entry.id, [BASE_KEY]: scrollKeyOf(below) });
    history.flush();
    entry.index = indexOf(history.location);
  });
  return entry;
}

function release(current: Tracker, entry: Entry) {
  if (entry.done) return;
  entry.done = true;
  current.stack = current.stack.filter((item) => item !== entry);
  run(current, async () => {
    const { history } = current;
    const top = history.location;
    if (entry.index === null || stateOf(top)[MARKER] !== entry.id) return;
    await new Promise<void>((resolve) => {
      current.popped = resolve;
      setTimeout(resolve, POP_TIMEOUT_MS);
      history.back();
    });
  });
}

const enabled = () =>
  typeof window !== 'undefined' && window.matchMedia?.(BACK_STACK_QUERY).matches === true;

/**
 * While `open`, Back calls `close` instead of leaving the page. `close` may leave it open (one of
 * several things cancelled): it then takes a new entry, for the next Back.
 */
export function useBackClose(open: boolean, close: () => void): void {
  // A component test may render a dialog without a router: then Back is simply not handled.
  const history = (useRouter({ warn: false }) as ReturnType<typeof useRouter> | undefined)?.history;
  const latestClose = useRef(close);
  const [round, setRound] = useState(0);
  useEffect(() => {
    latestClose.current = close;
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: `round` re-runs it after a Back
  useEffect(() => {
    if (!open || !history || !enabled()) return;
    const current = trackerFor(history);
    const entry = pushEntry(current, () => {
      setRound((value) => value + 1);
      latestClose.current();
    });
    return () => release(current, entry);
  }, [open, history, round]);
}
