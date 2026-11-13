/**
 * Group chats color each sender's name with one of 8 token colors (`--color-sender1..8`), all
 * WCAG AA on incoming bubbles in both themes. Literal class names so Tailwind generates them.
 */
export const SENDER_COLOR_CLASSES = [
  'text-sender1',
  'text-sender2',
  'text-sender3',
  'text-sender4',
  'text-sender5',
  'text-sender6',
  'text-sender7',
  'text-sender8',
] as const;

/** FNV-1a: tiny, fast and well-distributed for short ids. */
function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** The same user id always gets the same color, on every device. */
export function senderColorClass(userId: string): string {
  return SENDER_COLOR_CLASSES[hash(userId) % SENDER_COLOR_CLASSES.length] ?? 'text-sender1';
}
