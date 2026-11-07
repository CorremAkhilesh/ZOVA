/**
 * Syntax highlighting, loaded only through `import('./highlight')` from CodeBlock, so lowlight,
 * its grammars and the token colors live in their own chunk, never in the main bundle.
 */
import { common, createLowlight } from 'lowlight';
import type { ReactNode } from 'react';
import { type HastRoot, hastToReact } from './hast-react';
import './highlight.css';

const lowlight = createLowlight(common);

/** Longer code stays plain: highlighting it would block the main thread for too long. */
export const MAX_HIGHLIGHT_CHARS = 20_000;
/**
 * Without a language tag we only colour code highlight.js is fairly sure about; prose or a short
 * snippet guessed as some language looks worse than plain monospace.
 */
export const AUTO_MIN_RELEVANCE = 5;

/**
 * - language given and known to `common` (aliases like `ts`, `js`, `py` included) → that grammar;
 * - language given but unknown, or plain text (`text`) → plain, the sender said what it is;
 * - no language → auto-detect, used only when relevance ≥ AUTO_MIN_RELEVANCE.
 */
export function highlightTree(code: string, language: string | null): HastRoot | null {
  if (code.length === 0 || code.length > MAX_HIGHLIGHT_CHARS) return null;
  if (language) {
    if (!lowlight.registered(language)) return null;
    const tree = lowlight.highlight(language, code);
    // `text`/`plaintext` is registered but colors nothing: keep it plain.
    return tree.children.some((node) => node.type === 'element') ? tree : null;
  }
  const tree = lowlight.highlightAuto(code);
  return (tree.data?.relevance ?? 0) >= AUTO_MIN_RELEVANCE ? tree : null;
}

/** Highlighted React nodes for `code`, or null when it should stay plain. */
export function renderHighlighted(code: string, language: string | null): ReactNode[] | null {
  const tree = highlightTree(code, language);
  return tree ? hastToReact(tree.children) : null;
}
