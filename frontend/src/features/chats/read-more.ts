/** A message longer than this (characters or lines) shows its start and "Read more". */
export const READ_MORE_CHARS = 1000;
export const READ_MORE_LINES = 20;
/** How much of a long message shows before "Read more". */
const SHOWN_CHARS = 700;
const SHOWN_LINES = 15;

/**
 * The start of a long message, cut at a word (or line) boundary; null when it is short enough to
 * show whole. Emoji and other surrogate pairs are never split.
 */
export function readMoreCut(text: string): string | null {
  const lines = text.split('\n');
  if (text.length <= READ_MORE_CHARS && lines.length <= READ_MORE_LINES) return null;
  let cut = lines.slice(0, SHOWN_LINES).join('\n');
  if (cut.length > SHOWN_CHARS) {
    const chars = Array.from(cut).slice(0, SHOWN_CHARS).join('');
    const space = chars.search(/\s\S*$/);
    cut = space > SHOWN_CHARS / 2 ? chars.slice(0, space) : chars;
  }
  return `${cut.trimEnd()}…`;
}
