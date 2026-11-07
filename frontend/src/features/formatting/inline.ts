import { findLinks } from './links';
import type { EmphasisKind, InlineNode } from './types';

/**
 * Inline parser for one line. WhatsApp-style rules: an opening marker sits at the start or after
 * whitespace/punctuation and is followed by a non-space; a closing marker follows a non-space and
 * is followed by the end, whitespace or punctuation. Code spans and links are found first and are
 * atomic (no markers inside them count). Delimiters are matched with per-marker stacks, so the
 * whole pass is linear in the line length.
 */

const MARKERS: Readonly<Record<string, EmphasisKind>> = { '*': 'bold', _: 'italic', '~': 'strike' };
const BOUNDARY = /[\s\p{P}\p{S}]/u;
const SPACE = /\s/u;
/** Deeper pairs render as literal text: keeps rendering shallow for adversarial input. */
const MAX_DEPTH = 8;

/** The whole code point before `i` (handles surrogate pairs such as emoji). */
function before(line: string, i: number): string | undefined {
  if (i <= 0) return undefined;
  const low = line.charCodeAt(i - 1);
  const start = low >= 0xdc00 && low <= 0xdfff && i >= 2 ? i - 2 : i - 1;
  return String.fromCodePoint(line.codePointAt(start) ?? 0);
}

function at(line: string, i: number): string | undefined {
  const cp = line.codePointAt(i);
  return cp === undefined ? undefined : String.fromCodePoint(cp);
}

function canOpen(line: string, i: number, len: number): boolean {
  const prev = before(line, i);
  const next = at(line, i + len);
  return (prev === undefined || BOUNDARY.test(prev)) && next !== undefined && !SPACE.test(next);
}

function canClose(line: string, i: number, len: number): boolean {
  const prev = before(line, i);
  const next = at(line, i + len);
  return prev !== undefined && !SPACE.test(prev) && (next === undefined || BOUNDARY.test(next));
}

interface Atom {
  start: number;
  end: number;
  node: InlineNode;
}

interface Run {
  pos: number;
  len: number;
}

function backtickRuns(line: string): Run[] {
  const runs: Run[] = [];
  for (let i = line.indexOf('`'); i !== -1; i = line.indexOf('`', i)) {
    let j = i;
    while (line[j] === '`') j++;
    runs.push({ pos: i, len: j - i });
    i = j;
  }
  return runs;
}

/**
 * `code` spans: a backtick run closed by the next valid run of the same length. Closers are
 * grouped by length and walked with one cursor each, so finding them stays linear.
 */
function findCodeSpans(line: string): Atom[] {
  const runs = backtickRuns(line);
  const closers = new Map<number, { list: Run[]; next: number }>();
  for (const run of runs) {
    if (!canClose(line, run.pos, run.len)) continue;
    const group = closers.get(run.len) ?? { list: [], next: 0 };
    group.list.push(run);
    closers.set(run.len, group);
  }
  const closerAfter = (run: Run): Run | undefined => {
    const group = closers.get(run.len);
    if (!group) return undefined;
    while ((group.list[group.next]?.pos ?? Number.POSITIVE_INFINITY) <= run.pos) group.next++;
    return group.list[group.next];
  };
  const spans: Atom[] = [];
  let after = 0;
  for (const run of runs) {
    if (run.pos < after || !canOpen(line, run.pos, run.len)) continue;
    const close = closerAfter(run);
    if (!close) continue;
    after = close.pos + close.len;
    const text = line.slice(run.pos + run.len, close.pos);
    spans.push({ start: run.pos, end: after, node: { type: 'code', text } });
  }
  return spans;
}

function findAtoms(line: string): Atom[] {
  const atoms: Atom[] = [];
  let from = 0;
  const addLinks = (to: number) => {
    for (const link of findLinks(line.slice(from, to))) {
      atoms.push({ start: from + link.start, end: from + link.end, node: link.node });
    }
  };
  for (const span of findCodeSpans(line)) {
    addLinks(span.start);
    atoms.push(span);
    from = span.end;
  }
  addLinks(line.length);
  return atoms;
}

type Pairs = Map<number, { close: number; kind: EmphasisKind }>;

/** One marker character: closes the innermost same-marker opener, or opens a new one. */
function onMarker(line: string, i: number, stacks: Record<string, number[]>, pairs: Pairs): void {
  const char = line[i] ?? '';
  const kind = MARKERS[char];
  const stack = stacks[char];
  if (!kind || !stack) return;
  const top = stack.at(-1);
  if (top !== undefined && i > top + 1 && canClose(line, i, 1)) {
    stack.pop();
    pairs.set(top, { close: i, kind });
    // Openers inside the closed pair can no longer close: pairs never cross.
    for (const other of Object.values(stacks)) {
      while ((other.at(-1) ?? -1) > top) other.pop();
    }
  } else if (canOpen(line, i, 1)) {
    stack.push(i);
  }
}

/** Matches emphasis markers outside atoms; returns opener position → closer + kind. */
function matchEmphasis(line: string, atoms: Atom[]): Pairs {
  const pairs: Pairs = new Map();
  const stacks: Record<string, number[]> = { '*': [], _: [], '~': [] };
  let a = 0;
  let i = 0;
  while (i < line.length) {
    const atom = atoms[a];
    if (atom?.start === i) {
      i = atom.end;
      a++;
    } else {
      onMarker(line, i, stacks, pairs);
      i++;
    }
  }
  return pairs;
}

export function parseInline(line: string): InlineNode[] {
  if (line.length === 0) return [];
  const atoms = findAtoms(line);
  const atomAt = new Map(atoms.map((atom) => [atom.start, atom]));
  const pairs = matchEmphasis(line, atoms);

  const build = (from: number, to: number, depth: number): InlineNode[] => {
    const nodes: InlineNode[] = [];
    let textStart = from;
    const flush = (end: number) => {
      if (end > textStart) nodes.push({ type: 'text', text: line.slice(textStart, end) });
    };
    let i = from;
    while (i < to) {
      const atom = atomAt.get(i);
      const pair = pairs.get(i);
      if (atom) {
        flush(i);
        nodes.push(atom.node);
        i = atom.end;
        textStart = i;
      } else if (pair && depth < MAX_DEPTH) {
        flush(i);
        nodes.push({ type: pair.kind, children: build(i + 1, pair.close, depth + 1) });
        i = pair.close + 1;
        textStart = i;
      } else {
        i++;
      }
    }
    flush(to);
    return nodes;
  };
  return build(0, line.length, 0);
}
