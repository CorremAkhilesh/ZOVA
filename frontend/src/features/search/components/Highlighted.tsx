import type { ReactNode } from 'react';
import { wordsOf } from '../local-search';

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Plain text with every typed word marked. Never HTML: only strings and <mark> elements. */
export function Highlighted({ text, q }: { text: string; q: string }) {
  const words = wordsOf(q);
  if (words.length === 0) return <>{text}</>;
  const pattern = new RegExp(`(${words.map(escapeRegex).join('|')})`, 'giu');
  const parts: ReactNode[] = text.split(pattern).map((part, index) =>
    index % 2 === 1 ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: parts of one fixed string
      <mark key={index} className="rounded-sm bg-warning/40 text-inherit">
        {part}
      </mark>
    ) : (
      part
    ),
  );
  return <>{parts}</>;
}
