import type { SystemEvent } from '@zuvo/protocol';

/** Kinds whose line does not show the new value: a run of them reads the same each time. */
const VALUE_HIDDEN = new Set<SystemEvent['kind']>([
  'photo_changed',
  'description_changed',
  'pinned',
]);

/**
 * What a system line says, as a key: two events with the same key read exactly the same, so a run
 * of them becomes one line with a count ("You changed the group photo (3)").
 */
export function systemKey(event: SystemEvent): string {
  const targets = (event.targets ?? []).map((target) => target.id).join(',');
  const value = VALUE_HIDDEN.has(event.kind) ? '' : (event.value ?? '');
  return [event.kind, event.actor?.id ?? '', targets, value].join('|');
}

/** Whether `next` repeats `previous` closely enough to join its line. */
export const repeatsSystem = (
  previous: SystemEvent | null | undefined,
  next: SystemEvent | null | undefined,
) => Boolean(previous && next && systemKey(previous) === systemKey(next));
