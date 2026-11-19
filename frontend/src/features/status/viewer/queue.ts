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

interface StatusViewerState {
  queue: ViewerPerson[] | null;
  at: ViewerPosition;
  open: (queue: ViewerPerson[], person: number) => void;
  go: (at: ViewerPosition) => void;
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
  close: () => set({ queue: null, at: { person: 0, status: 0 } }),
}));
