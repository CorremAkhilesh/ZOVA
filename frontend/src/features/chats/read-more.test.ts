import { describe, expect, it } from 'vitest';
import { READ_MORE_CHARS, READ_MORE_LINES, readMoreCut } from './read-more';

describe('Read more', () => {
  it('leaves short messages whole', () => {
    expect(readMoreCut('Hello')).toBeNull();
    expect(readMoreCut('a'.repeat(READ_MORE_CHARS))).toBeNull();
    expect(readMoreCut(Array(READ_MORE_LINES).fill('line').join('\n'))).toBeNull();
  });

  it('cuts a message of many lines after 15 of them', () => {
    const text = Array.from({ length: 25 }, (_, i) => `line ${i + 1}`).join('\n');
    const cut = readMoreCut(text) ?? '';
    expect(cut.split('\n')).toHaveLength(15);
    expect(cut.endsWith('line 15…')).toBe(true);
  });

  it('cuts a very long paragraph at a word, never inside an emoji', () => {
    const text = `${'word '.repeat(300)}😀😀`;
    const cut = readMoreCut(text) ?? '';
    expect(cut.length).toBeLessThanOrEqual(701);
    expect(cut.endsWith('word…')).toBe(true);
    const emoji = readMoreCut('😀'.repeat(1200)) ?? '';
    expect(Array.from(emoji.slice(0, -1)).every((char) => char === '😀')).toBe(true);
  });
});
