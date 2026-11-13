import { Fragment, type ReactNode, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { CodeBlock } from './CodeBlock';
import { parse } from './parse';
import type { BlockNode, InlineLine, InlineNode } from './types';

/** Defence in depth: the parser only builds these, but nothing else may ever reach an href. */
const SAFE_HREF = /^(?:https?:\/\/|mailto:|tel:)/i;

type Marker = (text: string, key: string) => ReactNode;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Wraps case-insensitive matches of `term` in <mark>; a plain identity when there is no term. */
function makeMarker(term: string | undefined): Marker {
  const trimmed = term?.trim();
  if (!trimmed) return (text) => text;
  const pattern = new RegExp(escapeRegExp(trimmed), 'giu');
  return (text, key) => {
    const parts: ReactNode[] = [];
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index > last) parts.push(text.slice(last, match.index));
      parts.push(
        <mark key={`${key}m${match.index}`} className="rounded-sm bg-warning/40 text-inherit">
          {match[0]}
        </mark>,
      );
      last = match.index + match[0].length;
    }
    if (parts.length === 0) return text;
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  };
}

/** An "@Name" in the text: a button to the person's profile, or plain text once they left. */
export interface MentionMark {
  text: string;
  userId: string;
  active: boolean;
}

/** Turns the active mentions into buttons, and passes the rest of the text on to `inner`. */
function withMentions(
  inner: Marker,
  mentions: MentionMark[] | undefined,
  onMention: ((userId: string) => void) | undefined,
): Marker {
  const active = (mentions ?? []).filter((mention) => mention.active);
  if (active.length === 0) return inner;
  const byText = new Map(active.map((mention) => [mention.text, mention.userId]));
  const longestFirst = [...byText.keys()].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(${longestFirst.map(escapeRegExp).join('|')})`, 'gu');
  return (text, key) =>
    text.split(pattern).map((part, index) => {
      const userId = index % 2 === 1 ? byText.get(part) : undefined;
      const partKey = `${key}@${index}`;
      if (!userId) return <Fragment key={partKey}>{inner(part, partKey)}</Fragment>;
      return (
        <button
          key={partKey}
          type="button"
          data-mention={userId}
          onClick={(event) => {
            event.stopPropagation();
            onMention?.(userId);
          }}
          className="rounded px-0.5 font-semibold text-accent-text hover:underline"
        >
          {inner(part, partKey)}
        </button>
      );
    });
}

function renderInline(nodes: InlineNode[], mark: Marker, prefix: string): ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${prefix}${index}`;
    switch (node.type) {
      case 'text':
        return <Fragment key={key}>{mark(node.text, key)}</Fragment>;
      case 'bold':
        return (
          <strong key={key} className="font-semibold">
            {renderInline(node.children, mark, `${key}.`)}
          </strong>
        );
      case 'italic':
        return <em key={key}>{renderInline(node.children, mark, `${key}.`)}</em>;
      case 'strike':
        return <s key={key}>{renderInline(node.children, mark, `${key}.`)}</s>;
      case 'code':
        return (
          <code
            key={key}
            className="rounded bg-black/10 px-1 py-px font-mono text-[0.9em] dark:bg-white/15"
          >
            {node.text}
          </code>
        );
      case 'link':
        if (!SAFE_HREF.test(node.href))
          return <Fragment key={key}>{mark(node.text, key)}</Fragment>;
        return (
          <a
            key={key}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="underline underline-offset-2 [overflow-wrap:anywhere] hover:opacity-80"
          >
            {mark(node.text, key)}
          </a>
        );
    }
    return null;
  });
}

function renderLines(lines: InlineLine[], mark: Marker, prefix: string): ReactNode[] {
  return lines.map((line, index) => (
    // biome-ignore lint/suspicious/noArrayIndexKey: lines are static, derived from the text.
    <Fragment key={index}>
      {index > 0 ? '\n' : null}
      {renderInline(line, mark, `${prefix}${index}:`)}
    </Fragment>
  ));
}

function renderBlock(block: BlockNode, mark: Marker, key: string, trailing?: ReactNode): ReactNode {
  switch (block.type) {
    case 'paragraph':
      return (
        <p key={key}>
          {renderLines(block.lines, mark, key)}
          {trailing}
        </p>
      );
    case 'quote':
      return (
        <blockquote key={key} className="my-0.5 border-l-4 border-current/40 pl-2 opacity-90">
          {renderLines(block.lines, mark, key)}
        </blockquote>
      );
    case 'list':
      return (
        <ul key={key} className="my-0.5 list-disc pl-5">
          {block.items.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: items are static, derived from the text.
            <li key={index}>{renderInline(item, mark, `${key}.${index}:`)}</li>
          ))}
        </ul>
      );
    case 'codeBlock':
      return <CodeBlock key={key} code={block.code} language={block.language} />;
  }
}

interface FormattedTextProps {
  /** The raw message text. */
  text: string;
  /** In-chat search term, marked case-insensitively in plain text (not in code). */
  highlight?: string | undefined;
  className?: string | undefined;
  /** Inline content kept at the end of the last line (the bubble's room for its time). */
  trailing?: ReactNode;
  /** Group mentions in the text; tapping an active one calls onMention with who it is. */
  mentions?: MentionMark[] | undefined;
  onMention?: ((userId: string) => void) | undefined;
}

/**
 * Renders message text with *bold*, _italic_, ~strike~, `code`, code blocks, quotes, lists and
 * auto-links. Output is built from React elements only: no HTML strings, and links are limited
 * to http(s), mailto and tel. The root is a <div> (it holds blocks), keeping line breaks.
 */
export function FormattedText({
  text,
  highlight,
  className,
  trailing,
  mentions,
  onMention,
}: FormattedTextProps) {
  const blocks = useMemo(() => parse(text), [text]);
  const mark = useMemo(
    () => withMentions(makeMarker(highlight), mentions, onMention),
    [highlight, mentions, onMention],
  );
  const last = blocks.length - 1;
  // A paragraph keeps `trailing` on its last line; anything else gets it on a line of its own.
  const inline = blocks[last]?.type === 'paragraph';
  return (
    <div data-formatted className={cn('whitespace-pre-wrap [overflow-wrap:anywhere]', className)}>
      {blocks.map((block, index) =>
        renderBlock(block, mark, `b${index}`, index === last && inline ? trailing : undefined),
      )}
      {trailing && !inline ? <p>{trailing}</p> : null}
    </div>
  );
}
