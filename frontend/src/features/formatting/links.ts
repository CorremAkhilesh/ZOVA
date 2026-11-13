import type { InlineNode, LinkKind } from './types';

type LinkNode = Extract<InlineNode, { type: 'link' }>;

export interface LinkMatch {
  start: number;
  end: number;
  node: LinkNode;
}

/**
 * Auto-linking for plain text. Every detector is a single left-to-right scan (no nested,
 * ambiguous regex quantifiers), so adversarial input stays linear. Only `https?:`, `mailto:`
 * and `tel:` hrefs are ever produced: the href is built here from a matched shape, never copied
 * from a scheme the user typed.
 */

const WORD = /[\p{L}\p{N}\p{M}]/u;
const DIGIT = /[0-9]/;
const isWord = (c: string | undefined) => c !== undefined && WORD.test(c);
const isDigit = (c: string | undefined) => c !== undefined && DIGIT.test(c);

/** `[^\s<>"]+` cannot backtrack into itself; the lookbehind keeps links out of words and emails. */
const URL_START = /(?<![\p{L}\p{N}\p{M}@./_-])(?:https?:\/\/|www\.)[^\s<>"]+/giu;
const TRAILING = new Set(['.', ',', '!', '?', ':', ';', "'", '*', '_', '~', '`']);
const HOST_LABEL = /^[\p{L}\p{N}][\p{L}\p{N}\p{M}-]{0,62}$/u;

/** Drops trailing punctuation and an unbalanced closing bracket: `(see www.a.com).` → `www.a.com`. */
export function trimUrl(raw: string): string {
  let end = raw.length;
  const tally = { '(': 0, ')': 0, '[': 0, ']': 0 };
  for (const c of raw) if (c in tally) tally[c as keyof typeof tally]++;
  while (end > 0) {
    const last = raw[end - 1] ?? '';
    const open = last === ')' ? '(' : last === ']' ? '[' : null;
    if (open && tally[last as ')' | ']'] > tally[open]) tally[last as ')' | ']']--;
    else if (!TRAILING.has(last)) break;
    end--;
  }
  return raw.slice(0, end);
}

function validHost(host: string, minLabels: number): boolean {
  const port = /:(\d{1,5})$/.exec(host);
  const name = port ? host.slice(0, port.index) : host;
  const labels = name.split('.');
  if (labels.length < minLabels && name !== 'localhost') return false;
  return labels.every((label) => HOST_LABEL.test(label) && !label.endsWith('-'));
}

function findUrls(text: string, out: LinkMatch[]): void {
  for (const match of text.matchAll(URL_START)) {
    const url = trimUrl(match[0]);
    const www = url.slice(0, 4).toLowerCase() === 'www.';
    const rest = www ? url : url.slice(url.indexOf('//') + 2);
    const host = rest.split(/[/?#]/, 1)[0] ?? '';
    if (!validHost(host, www ? 3 : 2)) continue;
    const href = www ? `https://${url}` : url;
    out.push({ start: match.index, end: match.index + url.length, node: link('url', href, url) });
  }
}

const LOCAL = /[A-Za-z0-9._%+-]/;
const DOMAIN = /[A-Za-z0-9.-]/;

function validDomain(domain: string): boolean {
  const labels = domain.split('.');
  if (labels.length < 2 || !/^[A-Za-z]{2,}$/.test(labels.at(-1) ?? '')) return false;
  return labels.every((l) => /^[A-Za-z0-9-]+$/.test(l) && !l.startsWith('-') && !l.endsWith('-'));
}

function emailAt(text: string, at: number): LinkMatch | null {
  let start = at;
  while (start > 0 && LOCAL.test(text[start - 1] ?? '')) start--;
  while (start < at && !/[A-Za-z0-9]/.test(text[start] ?? '')) start++;
  let end = at + 1;
  while (end < text.length && DOMAIN.test(text[end] ?? '')) end++;
  while (end > at + 1 && /[.-]/.test(text[end - 1] ?? '')) end--;
  const bounded = !isWord(text[start - 1]) && !isWord(text[end]) && text[end] !== '@';
  if (start === at || !bounded || !validDomain(text.slice(at + 1, end))) return null;
  const email = text.slice(start, end);
  return { start, end, node: link('email', `mailto:${email}`, email) };
}

function findEmails(text: string, out: LinkMatch[]): void {
  for (let at = text.indexOf('@'); at !== -1; at = text.indexOf('@', at + 1)) {
    const match = emailAt(text, at);
    if (match) out.push(match);
  }
}

const DATE_PREFIX = /^(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}-\d{1,2}-\d{2,4})(?!\d)/;
const BEFORE_PHONE = /[+\-./:@_#,]/;

interface PhoneScan {
  /** Next index to look at. */
  j: number;
  /** End of the run (after its last digit or ")"), -1 when none yet. */
  end: number;
  digits: number;
  open: boolean;
}

const isSeparator = (c: string | undefined, prev: string | undefined, next: string | undefined) =>
  (c === ' ' || c === '-') && (isDigit(prev) || prev === ')') && (isDigit(next) || next === '(');

/** Advances the scan by one character; false when the phone-shaped run ends here. */
function stepPhone(text: string, i: number, scan: PhoneScan): boolean {
  const c = text[scan.j];
  const prev = text[scan.j - 1];
  const next = text[scan.j + 1];
  if (isDigit(c)) {
    scan.digits++;
    scan.end = scan.j + 1;
  } else if (c === '(' && !scan.open && (scan.j === i || prev === '+' || prev === ' ')) {
    if (!isDigit(next)) return false;
    scan.open = true;
  } else if (c === ')' && scan.open && isDigit(prev)) {
    scan.open = false;
    scan.end = scan.j + 1;
  } else if (!isSeparator(c, prev, next)) {
    return false;
  }
  scan.j++;
  return true;
}

/** Scans one phone-shaped run from `i` (digits, single spaces/dashes, one "(…)" group). */
function scanPhone(text: string, i: number): PhoneScan {
  const scan: PhoneScan = { j: text[i] === '+' ? i + 1 : i, end: -1, digits: 0, open: false };
  while (scan.j < text.length) {
    if (!stepPhone(text, i, scan)) break;
  }
  // An unclosed "(" makes the whole run suspect.
  if (scan.open) scan.end = -1;
  scan.j = Math.max(scan.j, i + 1);
  return scan;
}

function canStartPhone(text: string, i: number): boolean {
  const c = text[i];
  const prev = text[i - 1];
  const startsRun = isDigit(c) || ((c === '+' || c === '(') && isDigit(text[i + 1]));
  return startsRun && !isWord(prev) && !(prev !== undefined && BEFORE_PHONE.test(prev));
}

/** Glued to a word, or a decimal/time/date continues it: "9876543210th", "1234567890.5". */
function gluedAfter(text: string, end: number): boolean {
  const next = text[end];
  return isWord(next) || (next !== undefined && /[.:/,-]/.test(next) && isDigit(text[end + 1]));
}

/** The phone at `i`, if any, and where to look next (always > i, so the scan stays linear). */
function phoneAt(text: string, i: number): { match: LinkMatch | null; next: number } {
  const scan = scanPhone(text, i);
  if (scan.end === -1) return { match: null, next: scan.j };
  const raw = text.slice(i, scan.end);
  const date = DATE_PREFIX.exec(raw);
  if (date) return { match: null, next: i + date[0].length };
  const plus = raw.startsWith('+');
  const enough = scan.digits >= (plus ? 8 : 10) && scan.digits <= 15;
  // Any later start inside this run ends at the same place, with fewer digits: skip it.
  if (!enough || gluedAfter(text, scan.end)) return { match: null, next: scan.j };
  const dial = `${plus ? '+' : ''}${raw.replace(/\D/g, '')}`;
  return {
    match: { start: i, end: scan.end, node: link('phone', `tel:${dial}`, raw) },
    next: scan.end,
  };
}

function findPhones(text: string, out: LinkMatch[]): void {
  let i = 0;
  while (i < text.length) {
    if (!canStartPhone(text, i)) {
      i++;
      continue;
    }
    const { match, next } = phoneAt(text, i);
    if (match) out.push(match);
    i = next;
  }
}

function link(kind: LinkKind, href: string, text: string): LinkNode {
  return { type: 'link', kind, href, text };
}

const PRIORITY: Record<LinkKind, number> = { url: 0, email: 1, phone: 2 };

/** Non-overlapping links in `text`, left to right; an earlier start wins, then url > email > phone. */
export function findLinks(text: string): LinkMatch[] {
  if (text.length === 0) return [];
  const all: LinkMatch[] = [];
  findUrls(text, all);
  findEmails(text, all);
  findPhones(text, all);
  all.sort((a, b) => a.start - b.start || PRIORITY[a.node.kind] - PRIORITY[b.node.kind]);
  const picked: LinkMatch[] = [];
  let last = 0;
  for (const match of all) {
    if (match.start >= last && match.end > match.start) {
      picked.push(match);
      last = match.end;
    }
  }
  return picked;
}
