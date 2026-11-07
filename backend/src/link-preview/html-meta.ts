/** Only this many characters of a page are scanned for metadata. */
export const MAX_SCAN_CHARS = 512 * 1024;

/** Elements whose content is raw text: skipped entirely so nothing inside is mistaken for tags. */
const RAW_TEXT = new Set(['script', 'style', 'template', 'textarea', 'xmp', 'iframe', 'noembed']);

export interface PageMeta {
  /** Raw (still entity-encoded) text of the first `<title>`. */
  title: string | null;
  /** `property` / `name` / `itemprop` (lower-cased) → raw `content`. The first tag wins. */
  meta: Map<string, string>;
}

const SEPARATOR = /[\s/]*/y;
const ATTRIBUTE_NAME = /[^\s/>=]+/y;
const EQUALS = /\s*=\s*/y;
const UNQUOTED_VALUE = /[^\s>]*/y;
const TAG_START = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)/y;

/** The text a sticky regex matches exactly at `at` ('' when it does not match). */
function matchAt(pattern: RegExp, text: string, at: number): string {
  pattern.lastIndex = at;
  return pattern.exec(text)?.[0] ?? '';
}

function readValue(html: string, at: number): [value: string, end: number] {
  const quote = html[at];
  if (quote === '"' || quote === "'") {
    const close = html.indexOf(quote, at + 1);
    const valueEnd = close === -1 ? html.length : close;
    return [html.slice(at + 1, valueEnd), valueEnd + 1];
  }
  const value = matchAt(UNQUOTED_VALUE, html, at);
  return [value, at + value.length];
}

/** Reads attributes after a tag name. Handles any order and double, single or unquoted values. */
export function readAttributes(
  html: string,
  start: number,
): { attributes: Map<string, string>; end: number } {
  const attributes = new Map<string, string>();
  let p = start;
  while (p < html.length) {
    p += matchAt(SEPARATOR, html, p).length;
    if (html[p] === '>') return { attributes, end: p + 1 };
    // Every pass consumes at least one character: a name, or the '=' of a nameless value.
    const name = matchAt(ATTRIBUTE_NAME, html, p).toLowerCase();
    p += name.length;
    const equals = matchAt(EQUALS, html, p);
    let value = '';
    if (equals !== '') [value, p] = readValue(html, p + equals.length);
    if (name !== '' && !attributes.has(name)) attributes.set(name, value);
  }
  return { attributes, end: html.length };
}

/** Index just past the closing tag `</name…>`, or the end of the text when there is none. */
function skipPast(html: string, from: number, name: string): { contentEnd: number; end: number } {
  const closing = new RegExp(`</${name}[s/>]`, 'gi');
  closing.lastIndex = from;
  const match = closing.exec(html);
  if (!match) return { contentEnd: html.length, end: html.length };
  return { contentEnd: match.index, end: afterTag(html, match.index) };
}

function afterTag(html: string, from: number): number {
  const gt = html.indexOf('>', from);
  return gt === -1 ? html.length : gt + 1;
}

function afterComment(html: string, start: number): number {
  const close = html.indexOf('-->', start + 4);
  return close === -1 ? html.length : close + 3;
}

function addMeta(meta: Map<string, string>, attributes: Map<string, string>): void {
  const key = attributes.get('property') ?? attributes.get('name') ?? attributes.get('itemprop');
  const content = attributes.get('content');
  const normalized = key?.trim().toLowerCase();
  if (normalized && content !== undefined && !meta.has(normalized)) meta.set(normalized, content);
}

/** Handles an opening tag whose name ends at `after`; returns where scanning continues. */
function openTag(html: string, name: string, after: number, page: PageMeta): number {
  const { attributes, end } = readAttributes(html, after);
  if (name === 'meta') addMeta(page.meta, attributes);
  if (name === 'title') {
    const { contentEnd, end: next } = skipPast(html, end, 'title');
    page.title ??= html.slice(end, contentEnd);
    return next;
  }
  return RAW_TEXT.has(name) ? skipPast(html, end, name).end : end;
}

/**
 * Collects `<title>` and `<meta>` from the head of a page (or its first 512 K characters).
 * This is a tokenizer, not a DOM: nothing is executed and only raw strings come out; comments
 * and raw-text elements such as `<script>` are skipped. Linear in the input size.
 */
export function extractPageMeta(document: string): PageMeta {
  const html = document.length > MAX_SCAN_CHARS ? document.slice(0, MAX_SCAN_CHARS) : document;
  const page: PageMeta = { title: null, meta: new Map() };
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    if (html.startsWith('<!--', lt)) {
      i = afterComment(html, lt);
      continue;
    }
    TAG_START.lastIndex = lt;
    const tag = TAG_START.exec(html);
    if (!tag) {
      i = lt + 1;
      continue;
    }
    const name = (tag[2] ?? '').toLowerCase();
    const after = lt + tag[0].length;
    if (tag[1] !== '/') i = openTag(html, name, after, page);
    else if (name === 'head') break;
    else i = afterTag(html, after);
  }
  return page;
}
