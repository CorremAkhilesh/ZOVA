/**
 * Small fuzzy matcher for the command palette: the query's characters must appear in the text in
 * order (spaces in the query are ignored). Higher scores are better; null means no match.
 *
 * Each matched character earns 1 point, plus:
 * - +6 when it starts a word (start of the text, or after a space or punctuation),
 * - +4 more when it is the very first character of the text (a prefix),
 * - +4 when it directly follows the previous matched character (a contiguous run).
 * A character that starts a new run in the middle of a word costs 3 instead, so scattered matches
 * ("d…a…r…k" spread over a long label) score below zero and are dropped. Shorter texts win ties.
 */

const isWordStart = (chars: string[], index: number) =>
  index === 0 || /[\s\p{P}\p{S}]/u.test(chars[index - 1] ?? ' ');

/** What matching t[at] earns, with the previous match at t[prev]. */
function pointsAt(chars: string[], at: number, prev: number): number {
  const wordStart = isWordStart(chars, at);
  let points = 1;
  if (wordStart) points += 6;
  if (at === 0) points += 4;
  if (prev >= 0 && at === prev + 1) points += 4;
  else if (!wordStart) points -= 4;
  return points;
}

const normalize = (text: string) => Array.from(text.normalize('NFC').toLocaleLowerCase());

interface Search {
  q: string[];
  t: string[];
  memo: Map<number, number | null>;
}

/** Best score for q[qi…] with the previous match at t[prev] (-1: none yet); null: no match. */
function best(search: Search, qi: number, prev: number): number | null {
  const { q, t, memo } = search;
  if (qi === q.length) return 0;
  const key = qi * (t.length + 1) + prev + 1;
  const cached = memo.get(key);
  if (cached !== undefined) return cached;
  let top: number | null = null;
  for (let at = prev + 1; at <= t.length - (q.length - qi); at += 1) {
    const rest = t[at] === q[qi] ? best(search, qi + 1, at) : null;
    if (rest !== null) top = Math.max(top ?? -Infinity, pointsAt(t, at, prev) + rest);
  }
  memo.set(key, top);
  return top;
}

export function fuzzyScore(query: string, text: string): number | null {
  const q = normalize(query).filter((char) => !/\s/u.test(char));
  if (q.length === 0) return 0;
  const t = normalize(text);
  if (q.length > t.length) return null;
  const score = best({ q, t, memo: new Map() }, 0, -1);
  if (score === null || score <= 0) return null;
  return score - t.length * 0.01;
}

/**
 * The best score over a command's label and its keywords. Keywords count a little less, so a
 * label that matches as well comes first.
 */
export function matchScore(query: string, label: string, keywords: readonly string[]) {
  let top = fuzzyScore(query, label);
  for (const keyword of keywords) {
    const score = fuzzyScore(query, keyword);
    if (score !== null && (top === null || score * 0.9 > top)) top = score * 0.9;
  }
  return top;
}
