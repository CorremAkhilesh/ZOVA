import { describe, expect, it } from 'vitest';
import { parse, toPlainText } from './parse';
import { show } from './test-utils';

describe('inline emphasis', () => {
  it.each([
    ['*bold*', '<b>bold</b>'],
    ['_italic_', '<i>italic</i>'],
    ['~strike~', '<s>strike</s>'],
    ['say *hi* now', 'say <b>hi</b> now'],
    ['*two words*', '<b>two words</b>'],
    ['(*bold*)', '(<b>bold</b>)'],
    ['*bold*, then', '<b>bold</b>, then'],
    ['"*quoted*"', '"<b>quoted</b>"'],
    ['*a* and *b*', '<b>a</b> and <b>b</b>'],
    ['*x*', '<b>x</b>'],
    ['*नमस्ते*', '<b>नमस्ते</b>'],
    ['_नमस्ते दुनिया_ ठीक', '<i>नमस्ते दुनिया</i> ठीक'],
    ['😀 *bold* 😀', '😀 <b>bold</b> 😀'],
    ['😀*bold*😀', '😀<b>bold</b>😀'],
  ])('%s', (input, expected) => {
    expect(show(input)).toBe(expected);
  });

  it.each([
    ['2*3*4', 'multiplication'],
    ['snake_case_name', 'mid-word underscores'],
    ['a * b * c', 'spaced asterisks'],
    ['**', 'empty pair'],
    ['****', 'only markers'],
    ['*unclosed', 'unclosed'],
    ['unopened*', 'unopened'],
    ['a * not bold*', 'space after opener'],
    ['*not bold *', 'space before closer'],
    ['*bold*text', 'closer glued to a word'],
    ['word*bold*', 'opener glued to a word'],
    ['नम*स्ते*', 'opener glued to a Hindi word'],
    ['~ ~', 'spaced tildes'],
    ['_', 'single marker'],
    ['*multi\nline*', 'markers never span lines'],
  ])('%s stays literal (%s)', (input) => {
    expect(show(input)).toBe(input);
  });

  it.each([
    ['*bold _italic_*', '<b>bold <i>italic</i></b>'],
    ['_*both*_', '<i><b>both</b></i>'],
    ['~*_all_*~', '<s><b><i>all</i></b></s>'],
    ['*a _b* c_', '<b>a _b</b> c_'],
    ['*bold `code*`', '*bold <code>code*</code>'],
    ['*see `x`*', '<b>see <code>x</code></b>'],
    ['**bold**', '<b><b>bold</b></b>'],
  ])('nesting: %s', (input, expected) => {
    expect(show(input)).toBe(expected);
  });

  it('caps nesting depth and keeps deeper markers as text', () => {
    const deep = `${'*'.repeat(12)}x${'*'.repeat(12)}`;
    const shown = show(deep);
    expect(shown.match(/<b>/g)).toHaveLength(8);
    expect(toPlainText(deep)).toBe(`****x****`);
  });
});

describe('inline code', () => {
  it.each([
    ['`code`', '<code>code</code>'],
    ['use `npm *i*` here', 'use <code>npm *i*</code> here'],
    ['`a_b_c` and _d_', '<code>a_b_c</code> and <i>d</i>'],
    ['``a ` b``', '<code>a ` b</code>'],
    ['`https://a.com`', '<code>https://a.com</code>'],
    ['run ```ls -la``` now', 'run <code>ls -la</code> now'],
    ['`unclosed', '`unclosed'],
    ['a`b`c', 'a`b`c'],
  ])('%s', (input, expected) => {
    expect(show(input)).toBe(expected);
  });
});

describe('blocks', () => {
  it.each([
    ['```const a = 1;```', 'C()[const a = 1;]'],
    ['```ts\nconst a: number = 1;\n```', 'C(ts)[const a: number = 1;]'],
    ['```TS\nx\n```', 'C(ts)[x]'],
    ['```\nline 1\nline 2\n```', 'C()[line 1\nline 2]'],
    ['```c++\nint x;```', 'C(c++)[int x;]'],
    ['```*not bold* _x_ https://a.com```', 'C()[*not bold* _x_ https://a.com]'],
    ['```not a lang tag\nbody```', 'C()[not a lang tag\nbody]'],
    ['before\n```js\nx()\n```\nafter', 'before / C(js)[x()] / after'],
    ['```a```tail', 'C()[a] / tail'],
    ['```never closed\n*b*', '```never closed\n<b>b</b>'],
    ['```\n```', '```\n```'],
    ['```', '```'],
  ])('code block %#', (input, expected) => {
    expect(show(input)).toBe(expected);
  });

  it.each([
    ['> quoted', 'Q[quoted]'],
    ['> one\n> *two*', 'Q[one\n<b>two</b>]'],
    ['> q\nplain', 'Q[q] / plain'],
    ['>no space', '>no space'],
    ['a > b', 'a > b'],
    ['- one\n- two', 'L[one|two]'],
    ['* one\n* _two_', 'L[one|<i>two</i>]'],
    ['- a\ntext\n- b', 'L[a] / text / L[b]'],
    ['-not a list', '-not a list'],
    ['*bold* line', '<b>bold</b> line'],
    ['line 1\nline 2\n\nline 4', 'line 1\nline 2\n\nline 4'],
  ])('lines %#', (input, expected) => {
    expect(show(input)).toBe(expected);
  });

  it('returns no blocks for empty text', () => {
    expect(parse('')).toEqual([]);
  });
});

describe('toPlainText', () => {
  it.each([
    ['*bold* _it_ ~st~ `code`', 'bold it st code'],
    ['```ts\nconst a = 1;\n```', 'const a = 1;'],
    ['> quoted *text*', 'quoted text'],
    ['- one\n* two', '• one\n• two'],
    ['see www.a.com or a@b.co', 'see www.a.com or a@b.co'],
    ['2*3*4 snake_case', '2*3*4 snake_case'],
    ['intro\n```\ncode\n```\noutro', 'intro\ncode\noutro'],
    ['', ''],
  ])('%s', (input, expected) => {
    expect(toPlainText(input)).toBe(expected);
  });
});

describe('performance', () => {
  it.each([
    ['*a', '*a'.repeat(2048)],
    ['* a', '*a '.repeat(1366)],
    ['_*~`', '_*~`'.repeat(1024)],
    ['open markers', '*a _a ~a '.repeat(455)],
    ['nested openers', `${'*'.repeat(2048)}a${'*'.repeat(2047)}`],
    ['backticks', '`a '.repeat(1366)],
    ['fences', '```\n'.repeat(1024)],
    ['quotes', '> *a\n'.repeat(820)],
    ['urls', 'http://'.repeat(585)],
    ['url parens', `http://a.com/${')'.repeat(4080)}`],
    ['emails', 'a@a.'.repeat(1024)],
    ['digits', '1 '.repeat(2047).concat('x')],
    ['phone-ish', '+1 (2'.repeat(819)],
  ])('stays fast on adversarial input: %s', (_, input) => {
    const started = performance.now();
    parse(input);
    toPlainText(input);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
