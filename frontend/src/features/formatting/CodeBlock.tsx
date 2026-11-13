import { Check, Copy } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

type Highlighter = typeof import('./highlight');

let loading: Promise<Highlighter> | null = null;

/** The highlighter chunk, fetched once and shared by every code block. A failed load is retried. */
export function loadHighlighter(): Promise<Highlighter> {
  loading ??= import('./highlight').catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

export const COPIED_MS = 1500;

function CopyButton({ code }: { code: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  const Icon = copied ? Check : Copy;
  return (
    <button
      type="button"
      className="tap-target flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-text-muted hover:bg-border/60 hover:text-text"
      aria-label={copied ? t('formatting.copied') : t('formatting.copyCode')}
      onClick={(event) => {
        event.stopPropagation();
        void copy();
      }}
    >
      <Icon className="size-3.5" aria-hidden />
      <span aria-hidden>{copied ? t('formatting.copied') : t('formatting.copy')}</span>
      <span className="sr-only" aria-live="polite">
        {copied ? t('formatting.copied') : ''}
      </span>
    </button>
  );
}

interface CodeBlockProps {
  code: string;
  /** From the opening fence (```ts); null to auto-detect. */
  language: string | null;
  className?: string | undefined;
}

/**
 * A fenced code block. Shows the plain code at once; syntax colors arrive when the lazily
 * imported highlighter chunk resolves. Long lines scroll inside the block.
 */
export function CodeBlock({ code, language, className }: CodeBlockProps) {
  const { t } = useTranslation();
  const [result, setResult] = useState<{
    code: string;
    language: string | null;
    nodes: ReactNode[];
  } | null>(null);

  useEffect(() => {
    let live = true;
    loadHighlighter()
      .then(({ renderHighlighted }) => {
        const nodes = renderHighlighted(code, language);
        if (live && nodes) setResult({ code, language, nodes });
      })
      .catch(() => {
        // Plain code is already on screen; colors are only a nicety.
      });
    return () => {
      live = false;
    };
  }, [code, language]);

  const nodes = result?.code === code && result.language === language ? result.nodes : null;
  return (
    <div
      className={cn(
        'zuvo-code my-1 overflow-hidden rounded-lg border border-border bg-surface text-text',
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-2 py-0.5">
        <span className="font-mono text-xs text-text-muted">
          {language ?? t('formatting.code')}
        </span>
        <CopyButton code={code} />
      </div>
      <pre
        className="overflow-x-auto whitespace-pre px-3 py-2 font-mono text-[0.8125rem] leading-relaxed"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: lets keyboard users scroll long lines.
        tabIndex={0}
      >
        <code data-highlighted={nodes ? 'true' : undefined}>{nodes ?? code}</code>
      </pre>
    </div>
  );
}
