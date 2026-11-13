/** Inline emphasis that may nest (`*bold _italic_*`). */
export type EmphasisKind = 'bold' | 'italic' | 'strike';

/** What an auto-detected link points at. Only these three can ever become an href. */
export type LinkKind = 'url' | 'email' | 'phone';

export type InlineNode =
  | { type: 'text'; text: string }
  | { type: EmphasisKind; children: InlineNode[] }
  /** `inline code`: literal, never formatted or linked. */
  | { type: 'code'; text: string }
  /** `href` is always `http(s)://`, `mailto:` or `tel:` — built by the parser, never copied raw. */
  | { type: 'link'; kind: LinkKind; href: string; text: string };

/** One line of inline content (lines never share a marker pair). */
export type InlineLine = InlineNode[];

export type BlockNode =
  /** Ordinary lines, rendered with their line breaks. */
  | { type: 'paragraph'; lines: InlineLine[] }
  /** Consecutive `> ` lines, without the marker. */
  | { type: 'quote'; lines: InlineLine[] }
  /** Consecutive `- ` / `* ` lines, one item per line, without the marker. */
  | { type: 'list'; items: InlineLine[] }
  /** ```lang\ncode``` — `code` is literal; `language` is null when none was given. */
  | { type: 'codeBlock'; language: string | null; code: string };

export type FormattedDocument = BlockNode[];
