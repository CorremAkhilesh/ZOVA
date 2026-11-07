import { parse } from './parse';
import type { BlockNode, InlineNode } from './types';

const TAG = { bold: 'b', italic: 'i', strike: 's' } as const;

function showInline(nodes: InlineNode[]): string {
  return nodes
    .map((node) => {
      switch (node.type) {
        case 'text':
          return node.text;
        case 'code':
          return `<code>${node.text}</code>`;
        case 'link':
          return `<${node.kind} ${node.href}>${node.text}</${node.kind}>`;
        default:
          return `<${TAG[node.type]}>${showInline(node.children)}</${TAG[node.type]}>`;
      }
    })
    .join('');
}

function showBlock(block: BlockNode): string {
  switch (block.type) {
    case 'paragraph':
      return block.lines.map(showInline).join('\n');
    case 'quote':
      return `Q[${block.lines.map(showInline).join('\n')}]`;
    case 'list':
      return `L[${block.items.map(showInline).join('|')}]`;
    case 'codeBlock':
      return `C(${block.language ?? ''})[${block.code}]`;
  }
}

/** A compact, readable rendering of the parse tree for table tests. */
export function show(text: string): string {
  return parse(text).map(showBlock).join(' / ');
}
