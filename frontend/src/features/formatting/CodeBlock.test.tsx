import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from '@/test/axe';
import { COPIED_MS, CodeBlock, loadHighlighter } from './CodeBlock';
import { hastToReact } from './hast-react';
import { AUTO_MIN_RELEVANCE, highlightTree, MAX_HIGHLIGHT_CHARS } from './highlight';

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('CodeBlock', () => {
  it('shows plain code at once, then highlighted spans after the lazy import', async () => {
    const { container } = render(<CodeBlock code={'const answer = 42;'} language="ts" />);
    const code = container.querySelector('pre code');
    expect(code?.textContent).toBe('const answer = 42;');
    expect(screen.getByText('ts')).toBeInTheDocument();

    await waitFor(() => expect(code).toHaveAttribute('data-highlighted', 'true'));
    expect(code?.querySelector('.hljs-keyword')).toHaveTextContent('const');
    expect(code?.querySelector('.hljs-number')).toHaveTextContent('42');
    expect(code?.textContent).toBe('const answer = 42;');
  });

  it('stays plain for an unknown language', async () => {
    const { container } = render(<CodeBlock code="just words here" language="text" />);
    await loadHighlighter();
    await act(async () => {});
    expect(container.querySelector('pre code')).not.toHaveAttribute('data-highlighted');
    expect(container.querySelector('pre code span')).toBeNull();
  });

  it('labels a block without a language as code', () => {
    render(<CodeBlock code="x" language={null} />);
    expect(screen.getByText('Code')).toBeInTheDocument();
  });

  it('copies the code and shows Copied for a moment', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<CodeBlock code={'echo hi\nexit'} language="sh" />);
    const button = screen.getByRole('button', { name: 'Copy code' });
    await act(async () => {
      fireEvent.click(button);
    });
    expect(writeText).toHaveBeenCalledWith('echo hi\nexit');
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(COPIED_MS + 10);
    });
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument();
  });

  it('stays on Copy when the clipboard refuses', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'));
    render(<CodeBlock code="x" language={null} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    });
    expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <main>
        <CodeBlock code={'function f() {\n  return 1;\n}'} language="js" />
      </main>,
    );
    await waitFor(() => expect(container.querySelector('[data-highlighted]')).not.toBeNull());
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('highlightTree', () => {
  it('uses the given language, aliases included', () => {
    expect(highlightTree('def f(): pass', 'py')?.children.some((n) => n.type === 'element')).toBe(
      true,
    );
    expect(highlightTree('plain words', 'text')).toBeNull();
    expect(highlightTree('{"a": 1}', 'json')).not.toBeNull();
  });

  it('leaves unknown languages, empty and huge code plain', () => {
    expect(highlightTree('x', 'klingon')).toBeNull();
    expect(highlightTree('', 'ts')).toBeNull();
    expect(highlightTree('a'.repeat(MAX_HIGHLIGHT_CHARS + 1), 'ts')).toBeNull();
  });

  it('auto-detects only confident guesses', () => {
    const code = '#include <stdio.h>\nint main(void) {\n  printf("hi\\n");\n  return 0;\n}';
    expect(highlightTree(code, null)?.data?.relevance ?? 0).toBeGreaterThanOrEqual(
      AUTO_MIN_RELEVANCE,
    );
    expect(highlightTree('see you tomorrow', null)).toBeNull();
  });
});

describe('hastToReact', () => {
  it('keeps highlight.js class names only and drops other node types', () => {
    const { container } = render(
      <code>
        {hastToReact([
          {
            type: 'element',
            tagName: 'span',
            properties: { className: ['hljs-keyword', 'evil" onclick="x', 'title', 'function_'] },
            children: [{ type: 'text', value: 'const' }],
          },
          { type: 'comment', value: 'ignored' },
          {
            type: 'element',
            tagName: 'script',
            properties: { className: ['bad'], onclick: 'alert(1)' },
            children: [{ type: 'text', value: 'x' }],
          },
        ])}
      </code>,
    );
    const spans = container.querySelectorAll('span');
    expect(spans[0]).toHaveAttribute('class', 'hljs-keyword function_');
    expect(spans[1]).not.toHaveAttribute('class');
    expect(spans[1]).not.toHaveAttribute('onclick');
    expect(container.querySelector('script')).toBeNull();
    expect(container.textContent).toBe('constx');
  });
});
