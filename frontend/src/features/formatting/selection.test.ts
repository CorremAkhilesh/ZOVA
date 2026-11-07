import { describe, expect, it } from 'vitest';
import { wrapSelection } from './parse';

/** `[` and `]` mark the selection in these fixtures. */
function run(fixture: string, marker = '*'): string {
  const start = fixture.indexOf('[');
  const end = fixture.indexOf(']') - 1;
  const value = fixture.replace('[', '').replace(']', '');
  const result = wrapSelection(value, start, end, marker);
  return `${result.value.slice(0, result.start)}[${result.value.slice(result.start, result.end)}]${result.value.slice(result.end)}`;
}

describe('wrapSelection', () => {
  it.each([
    ['say [hello] now', 'say *[hello]* now'],
    ['[hello ]world', '*[hello]* world'],
    ['say[ hello ]now', 'say *[hello]* now'],
    ['[नमस्ते]', '*[नमस्ते]*'],
    ['[two words]', '*[two words]*'],
  ])('wraps %s', (input, expected) => {
    expect(run(input)).toBe(expected);
  });

  it.each([
    ['say *[hello]* now', 'say [hello] now'],
    ['say [*hello*] now', 'say [hello] now'],
    ['[ *hello* ]', ' [hello] '],
  ])('toggles off %s', (input, expected) => {
    expect(run(input)).toBe(expected);
  });

  it('round-trips with the same shortcut', () => {
    const once = wrapSelection('hi there', 3, 8, '_');
    expect(once.value).toBe('hi _there_');
    const twice = wrapSelection(once.value, once.start, once.end, '_');
    expect(twice).toEqual({ value: 'hi there', start: 3, end: 8 });
  });

  it('inserts a pair with the caret inside when nothing is selected', () => {
    expect(run('ab[]cd')).toBe('ab*[]*cd');
    expect(run('[]', '~')).toBe('~[]~');
  });

  it('removes an empty pair around the caret', () => {
    expect(run('ab*[]*cd')).toBe('ab[]cd');
  });

  it('treats a whitespace-only selection like a caret', () => {
    expect(run('a[   ]b')).toBe('a   *[]*b');
  });

  it('wraps each line of a multi-line selection', () => {
    expect(run('[one\n\n two ]')).toBe('[*one*\n\n *two*] ');
    expect(run('[*one*\n*two*]')).toBe('[one\ntwo]');
  });

  it('accepts a reversed or out-of-range selection', () => {
    expect(wrapSelection('hello', 5, 0, '*')).toEqual({ value: '*hello*', start: 1, end: 6 });
    expect(wrapSelection('hello', -4, 99, '_').value).toBe('_hello_');
  });

  it('supports multi-character markers', () => {
    expect(run('[code]', '```')).toBe('```[code]```');
  });
});
