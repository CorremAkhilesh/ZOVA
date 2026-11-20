import type { PublicProfile, Status } from '@zuvo/protocol';
import { create } from 'zustand';

/** How long a photo or a text status stays on screen. A video plays for its own length. */
export const STILL_MS = 5000;

/** One person's statuses in the viewer, oldest first. */
export interface ViewerPerson {
  user: PublicProfile;
  statuses: Status[];
  mine: boolean;
}

export interface ViewerPosition {
  person: number;
  status: number;
}

/** The next status: the person's next one, else the next person's first. Null at the very end. */
export function nextPosition(queue: ViewerPerson[], at: ViewerPosition): ViewerPosition | null {
  const person = queue[at.person];
  if (person && at.status + 1 < person.statuses.length) {
    return { person: at.person, status: at.status + 1 };
  }
  return at.person + 1 < queue.length ? { person: at.person + 1, status: 0 } : null;
}

/** The status before: the person's previous one, else the previous person's last. */
export function previousPosition(queue: ViewerPerson[], at: ViewerPosition): ViewerPosition | null {
  if (at.status > 0) return { person: at.person, status: at.status - 1 };
  const before = queue[at.person - 1];
  return before ? { person: at.person - 1, status: before.statuses.length - 1 } : null;
}

/** Where to start with someone: their first status not seen yet (all seen: the first). */
export function firstUnseen(person: ViewerPerson): number {
  const index = person.statuses.findIndex((status) => !status.viewed);
  return index === -1 ? 0 : index;
}

/** How long this status runs, in ms. A video's own length (at most 60 s) once it is known. */
export function durationOf(status: Status, videoSeconds?: number): number {
  if (status.kind !== 'video') return STILL_MS;
  const seconds = videoSeconds ?? status.media?.duration ?? 0;
  return seconds > 0 ? Math.min(seconds, 60) * 1000 : STILL_MS;
}

/**
 * The queue without the statuses `keep` refuses (deleted, by me here or anywhere else, or expired).
 * The viewer stays on the same status if it is still there; if it went, on the one after it (the
 * same person's next, else the next person's first, else the last one left). Null: nothing left.
 */
export function withoutStatuses(
  queue: ViewerPerson[],
  at: ViewerPosition,
  keep: (status: Status) => boolean,
): { queue: ViewerPerson[]; at: ViewerPosition } | null {
  const people: ViewerPerson[] = [];
  let next: ViewerPosition | null = null;
  for (const [personIndex, person] of queue.entries()) {
    const statuses = person.statuses.filter(keep);
    if (statuses.length === 0) continue;
    people.push({ ...person, statuses });
    if (next || personIndex < at.person) continue;
    // The person being watched: this status, else the first after it that is left. Later people:
    // their first.
    const from =
      personIndex === at.person ? person.statuses.slice(at.status).find(keep) : statuses[0];
    if (from) next = { person: people.length - 1, status: statuses.indexOf(from) };
  }
  const last = people.at(-1);
  if (!last) return null;
  return {
    queue: people,
    at: next ?? { person: people.length - 1, status: last.statuses.length - 1 },
  };
}

interface StatusViewerState {
  queue: ViewerPerson[] | null;
  at: ViewerPosition;
  open: (queue: ViewerPerson[], person: number) => void;
  go: (at: ViewerPosition) => void;
  /** Takes out statuses that are gone; closes the viewer if none are left. */
  keepOnly: (keep: (status: Status) => boolean) => void;
  close: () => void;
}

/** The full-screen viewer: who is in it, and where it is. */
export const useStatusViewer = create<StatusViewerState>()((set) => ({
  queue: null,
  at: { person: 0, status: 0 },
  open: (queue, person) => {
    const chosen = queue[person];
    set({ queue, at: { person, status: chosen ? firstUnseen(chosen) : 0 } });
  },
  go: (at) => set({ at }),
  keepOnly: (keep) =>
    set((state) => {
      if (!state.queue) return state;
      const gone = state.queue.some((person) => person.statuses.some((status) => !keep(status)));
      if (!gone) return state;
      const left = withoutStatuses(state.queue, state.at, keep);
      return left ?? { queue: null, at: { person: 0, status: 0 } };
    }),
  close: () => set({ queue: null, at: { person: 0, status: 0 } }),
}));
