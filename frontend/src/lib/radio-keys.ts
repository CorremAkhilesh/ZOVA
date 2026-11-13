import type { KeyboardEvent } from 'react';

const NEXT = new Set(['ArrowRight', 'ArrowDown']);
const PREVIOUS = new Set(['ArrowLeft', 'ArrowUp']);

/**
 * Arrow keys for a `role="radiogroup"` of `role="radio"` buttons (WAI-ARIA radio pattern): move to
 * the next or previous option, wrapping around, and choose it. Home and End go to the ends.
 * Pair with `tabIndex={selected ? 0 : -1}` on each radio, so Tab enters the group once.
 */
export function onRadioGroupKeyDown(event: KeyboardEvent<HTMLElement>): void {
  const radios = [
    ...event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]:not([disabled])'),
  ];
  const current = radios.indexOf(event.target as HTMLElement);
  if (current === -1 || radios.length === 0) return;
  let next: number;
  if (NEXT.has(event.key)) next = (current + 1) % radios.length;
  else if (PREVIOUS.has(event.key)) next = (current - 1 + radios.length) % radios.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = radios.length - 1;
  else return;
  event.preventDefault();
  radios[next]?.focus();
  radios[next]?.click();
}
