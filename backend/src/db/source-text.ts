/** Reading TypeScript source as text: brackets, strings, comments, receivers (no compiler API). */

const OPEN: Record<string, string> = { '(': ')', '[': ']', '{': '}' };

/** Index just past the bracket that closes the one at `open`, skipping strings and comments. */
export function closeOf(text: string, open: number): number {
  const stack: string[] = [];
  for (let i = open; i < text.length; i++) {
    const ch = text[i] as string;
    if (ch === '/' && text[i + 1] === '/') {
      i = text.indexOf('\n', i);
      if (i < 0) return text.length;
    } else if (ch === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i) + 1;
      if (i <= 0) return text.length;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      i++;
      while (i < text.length && text[i] !== ch) i += text[i] === '\\' ? 2 : 1;
    } else if (ch in OPEN) {
      stack.push(OPEN[ch] as string);
    } else if (ch === ')' || ch === ']' || ch === '}') {
      stack.pop();
      if (stack.length === 0) return i + 1;
    }
  }
  return text.length;
}

/** Splits on `separator` at nesting depth 0. */
export function splitTop(text: string, separator = ','): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (ch in OPEN) {
      i = closeOf(text, i) - 1;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      i++;
      while (i < text.length && text[i] !== ch) i += text[i] === '\\' ? 2 : 1;
    } else if (ch === separator) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

const IDENT = /[\w$]/;

/** The expression a method is called on, read backwards from the `.` before the method name. */
export function receiverBefore(text: string, dot: number): string {
  let i = dot - 1;
  while (i >= 0) {
    while (i >= 0 && /\s/.test(text[i] as string)) i--;
    const ch = text[i] as string;
    if (ch === ')' || ch === ']') {
      let depth = 0;
      for (; i >= 0; i--) {
        const c = text[i] as string;
        if (c === ')' || c === ']') depth++;
        else if (c === '(' || c === '[') depth--;
        if (depth === 0) break;
      }
      i--;
    } else if (IDENT.test(ch)) {
      while (i >= 0 && IDENT.test(text[i] as string)) i--;
      let j = i;
      while (j >= 0 && /\s/.test(text[j] as string)) j--;
      if (text[j] === '.' || (text[j] === '?' && text[j + 1] === '.')) {
        i = text[j] === '?' ? j - 1 : j - 1;
        continue;
      }
      break;
    } else {
      break;
    }
  }
  return text.slice(i + 1, dot).replace(/\s+/g, '');
}

export function enclosingName(text: string, at: number): string | null {
  const head = text.slice(0, at);
  const decls = [
    ...head.matchAll(
      /^(?:export\s+)?(?:async\s+)?(?:function\*?\s+([\w$]+)|(?:const|let)\s+([\w$]+))/gm,
    ),
  ];
  const last = decls.at(-1);
  return last ? (last[1] ?? last[2] ?? null) : null;
}

export function lineAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

/** Comments replaced by spaces (newlines kept, so positions and line numbers stay the same). */
export function blankComments(source: string): string {
  let out = '';
  for (let i = 0; i < source.length; i++) {
    const ch = source[i] as string;
    const next = source[i + 1];
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < source.length && source[j] !== ch && source[j] !== '\n') {
        j += source[j] === '\\' ? 2 : 1;
      }
      out += source.slice(i, j + 1);
      i = j;
    } else if (ch === '/' && (next === '/' || next === '*')) {
      const end = next === '/' ? source.indexOf('\n', i) : source.indexOf('*/', i) + 2;
      const stop = end <= 1 ? source.length : end;
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop - 1;
    } else {
      out += ch;
    }
  }
  return out;
}
