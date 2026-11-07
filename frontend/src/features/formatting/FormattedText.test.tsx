import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe } from '@/test/axe';
import { FormattedText } from './FormattedText';
import { FormattingHint } from './FormattingHint';

const SAFE_TAGS = new Set([
  'DIV',
  'P',
  'STRONG',
  'EM',
  'S',
  'CODE',
  'A',
  'MARK',
  'BLOCKQUOTE',
  'UL',
  'LI',
  'PRE',
  'SPAN',
  'BUTTON',
  'svg',
  'path',
  'rect',
]);

function view(text: string, highlight?: string) {
  return render(<FormattedText text={text} highlight={highlight} />).container;
}

describe('FormattedText rendering', () => {
  it('renders emphasis as semantic elements', () => {
    const root = view('*bold* _italic_ ~gone~ `x = 1`');
    expect(root.querySelector('strong')).toHaveTextContent('bold');
    expect(root.querySelector('em')).toHaveTextContent('italic');
    expect(root.querySelector('s')).toHaveTextContent('gone');
    expect(root.querySelector('code')).toHaveTextContent('x = 1');
    expect(root).toHaveTextContent('bold italic gone x = 1');
  });

  it('renders links that open safely in a new tab', () => {
    const root = view('see www.a.com, mail x@y.io or call +91 98765 43210');
    const links = [...root.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      'https://www.a.com',
      'mailto:x@y.io',
      'tel:+919876543210',
    ]);
    for (const a of links) {
      expect(a).toHaveAttribute('target', '_blank');
      expect(a).toHaveAttribute('rel', 'noopener noreferrer nofollow');
    }
  });

  it('keeps line breaks inside a paragraph', () => {
    const root = view('one\ntwo\n\nfour');
    const p = root.querySelector('p');
    expect(p?.textContent).toBe('one\ntwo\n\nfour');
    expect(root.firstElementChild).toHaveClass('whitespace-pre-wrap');
  });

  it('renders quotes and lists', () => {
    const root = view('> quoted *x*\n- one\n- two');
    expect(root.querySelector('blockquote')).toHaveTextContent('quoted x');
    expect(root.querySelector('blockquote strong')).toHaveTextContent('x');
    expect([...root.querySelectorAll('ul > li')].map((li) => li.textContent)).toEqual([
      'one',
      'two',
    ]);
  });

  it('renders code blocks as pre > code', () => {
    const root = view('```\n*literal*\n```');
    expect(root.querySelector('pre code')?.textContent).toBe('*literal*');
    expect(root.querySelector('strong')).toBeNull();
  });

  it('marks the search term case-insensitively, inside emphasis and links too', () => {
    const root = view('Hello *hello world* `hello` www.hello.com', 'HELLO');
    const marks = [...root.querySelectorAll('mark')];
    expect(marks.map((m) => m.textContent)).toEqual(['Hello', 'hello', 'hello']);
    expect(root.querySelector('strong mark')).not.toBeNull();
    expect(root.querySelector('a mark')).not.toBeNull();
    expect(root.querySelector('code mark')).toBeNull();
  });

  it('treats the search term literally', () => {
    const root = view('a.b axb (x)', '.');
    expect(root.querySelectorAll('mark')).toHaveLength(1);
    expect(view('(x)', '(x)').querySelector('mark')).toHaveTextContent('(x)');
    expect(view('text', '   ').querySelector('mark')).toBeNull();
  });

  it('renders nothing for empty text', () => {
    expect(view('').firstElementChild?.childElementCount).toBe(0);
  });
});

describe('FormattedText XSS safety', () => {
  it.each([
    '<img src=x onerror=alert(1)>',
    '<script>alert(1)</script>',
    'javascript:alert(1)',
    '[x](javascript:alert(1))',
    '*<b>bold</b>*',
    'http://a.com/"><script>alert(1)</script>',
    'data:text/html,<script>alert(1)</script>',
    'JaVaScRiPt:alert(1) vbscript:msgbox(1) file:///etc/passwd',
    '<a href="javascript:alert(1)">x</a>',
    '`<svg onload=alert(1)>`',
    '```html\n<iframe src="javascript:alert(1)"></iframe>\n```',
    '> <style>body{display:none}</style>\n- <object data=x>',
    'www.a.com/<img src=x>',
    'x@y.io"><img src=x onerror=alert(1)>',
  ])('%s renders as literal text', (input) => {
    const root = view(input);
    for (const element of root.querySelectorAll('*')) {
      expect(SAFE_TAGS.has(element.tagName)).toBe(true);
      for (const attribute of element.attributes) {
        expect(attribute.name.startsWith('on')).toBe(false);
      }
    }
    for (const a of root.querySelectorAll('a')) {
      expect(a.getAttribute('href')).toMatch(/^(https?:\/\/|mailto:|tel:)/);
    }
    expect(root.querySelector('script, img, iframe, style, object, svg[onload]')).toBeNull();
    // What looked like markup is still on screen, as text.
    const tag = /<[^>]*>/.exec(input)?.[0];
    if (tag) expect(root.textContent).toContain(tag);
  });

  it('a bold-wrapped HTML tag is bold text, not markup', () => {
    const root = view('*<b>bold</b>*');
    expect(root.querySelector('strong')?.textContent).toBe('<b>bold</b>');
    expect(root.querySelector('b')).toBeNull();
  });
});

describe('FormattingHint', () => {
  it('shows the samples and one readable sentence for screen readers', () => {
    const { container } = render(<FormattingHint id="hint" />);
    const hint = container.querySelector('#hint');
    expect(hint?.querySelector('strong')).toHaveTextContent('bold');
    expect(hint?.querySelector('em')).toHaveTextContent('italic');
    expect(hint?.querySelector('s')).toHaveTextContent('strike');
    expect(hint?.querySelector('code')).toHaveTextContent('code');
    expect(hint?.querySelector('[aria-hidden]')).not.toBeNull();
    expect(hint?.querySelector('.sr-only')).toHaveTextContent(/asterisks.*bold/);
  });
});

describe('accessibility', () => {
  it('has no axe violations', async () => {
    const { container } = render(
      <main>
        <FormattedText
          text={'*bold* _it_ ~s~ `c` www.a.com x@y.io\n> quote\n- a\n- b\n```ts\nconst a = 1;\n```'}
          highlight="a"
        />
        <FormattingHint />
      </main>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });
});
