import { parseInline } from './inline';
import type { BlockNode, FormattedDocument, InlineLine, InlineNode } from './types';

export { wrapSelection } from './selection';
export type { BlockNode, FormattedDocument, InlineLine, InlineNode } from './types';

const FENCE = '```';
const QUOTE = /^> /;
const BULLET = /^[-*] /;
/** A language tag alone on the fence line, e.g. ```ts or ```c++. */
const LANGUAGE = /^[A-Za-z0-9_+#.-]{1,24}$/;

type LineKind = 'paragraph' | 'quote' | 'list';

/** ```lang\ncode``` starting at `pos` (a line start); null when it never closes. */
function readFence(text: string, pos: number): { block: BlockNode; next: number } | null {
  const bodyStart = pos + FENCE.length;
  const close = text.indexOf(FENCE, bodyStart);
  if (close === -1 || close === bodyStart) return null;
  let body = text.slice(bodyStart, close);
  let language: string | null = null;
  const newline = body.indexOf('\n');
  if (newline !== -1) {
    const first = body.slice(0, newline).trim();
    if (first === '' || LANGUAGE.test(first)) {
      language = first === '' ? null : first.toLowerCase();
      body = body.slice(newline + 1);
    }
  }
  if (body.endsWith('\n')) body = body.slice(0, -1);
  if (body.length === 0 && language === null) return null;
  // Whatever follows the closing fence on its line starts a new line.
  let next = close + FENCE.length;
  if (text[next] === '\n') next++;
  return { block: { type: 'codeBlock', language, code: body }, next };
}

function lineKind(line: string): LineKind {
  if (QUOTE.test(line)) return 'quote';
  return BULLET.test(line) ? 'list' : 'paragraph';
}

/** Groups consecutive lines of the same kind into one block. */
class BlockBuilder {
  readonly blocks: BlockNode[] = [];
  private kind: LineKind | null = null;
  private lines: InlineLine[] = [];

  line(text: string): void {
    const kind = lineKind(text);
    if (kind !== this.kind) this.flush();
    this.kind = kind;
    this.lines.push(parseInline(kind === 'paragraph' ? text : text.slice(2)));
  }

  block(block: BlockNode): void {
    this.flush();
    this.blocks.push(block);
  }

  flush(): void {
    if (this.kind === 'list') this.blocks.push({ type: 'list', items: this.lines });
    else if (this.kind) this.blocks.push({ type: this.kind, lines: this.lines });
    this.kind = null;
    this.lines = [];
  }
}

/**
 * Parses message text into blocks (paragraphs, quotes, lists, code blocks) of inline nodes.
 * Pure and linear-ish: every pass is a single scan, with no backtracking regexes on user text.
 */
export function parse(text: string): FormattedDocument {
  if (text.length === 0) return [];
  const builder = new BlockBuilder();
  let pos = 0;
  for (;;) {
    const fence = text.startsWith(FENCE, pos) ? readFence(text, pos) : null;
    if (fence) {
      builder.block(fence.block);
      pos = fence.next;
      if (pos >= text.length) break;
      continue;
    }
    const newline = text.indexOf('\n', pos);
    builder.line(text.slice(pos, newline === -1 ? text.length : newline));
    if (newline === -1) break;
    pos = newline + 1;
  }
  builder.flush();
  return builder.blocks;
}

function inlineText(nodes: InlineNode[]): string {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text' || node.type === 'code' || node.type === 'link') out += node.text;
    else out += inlineText(node.children);
  }
  return out;
}

/**
 * The text without formatting markers, for previews, notifications and search snippets:
 * `*bold*` → `bold`, fences dropped (code kept), `> ` dropped, list markers → `• `.
 */
export function toPlainText(text: string): string {
  return parse(text)
    .map((block) => {
      switch (block.type) {
        case 'codeBlock':
          return block.code;
        case 'list':
          return block.items.map((item) => `• ${inlineText(item)}`).join('\n');
        default:
          return block.lines.map(inlineText).join('\n');
      }
    })
    .join('\n');
}
