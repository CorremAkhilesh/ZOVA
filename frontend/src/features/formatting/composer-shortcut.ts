import type { KeyboardEvent } from 'react';
import { flushSync } from 'react-dom';
import { wrapSelection } from './selection';

const MARKERS: Record<string, string> = { b: '*', i: '_' };

/**
 * Ctrl/Cmd+B makes the selection *bold*, Ctrl/Cmd+I _italic_; pressing it again takes it off.
 * True when the key was one of these, and handled.
 */
export function formatShortcut(
  event: KeyboardEvent<HTMLTextAreaElement>,
  update: (next: string) => void,
): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return false;
  const marker = MARKERS[event.key.toLowerCase()];
  if (!marker) return false;
  event.preventDefault();
  const element = event.currentTarget;
  const next = wrapSelection(element.value, element.selectionStart, element.selectionEnd, marker);
  // Write the value now, then select: a later frame would land after the next key on a slow device
  // (Ctrl+B, Ctrl+I gave "*hello*__" instead of "*_hello_*").
  flushSync(() => update(next.value));
  element.setSelectionRange(next.start, next.end);
  return true;
}
