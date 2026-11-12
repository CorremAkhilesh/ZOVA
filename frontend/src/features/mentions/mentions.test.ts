import { describe, expect, it } from 'vitest';
import { findMentions, insertMention, mentionQuery, mentionSpans } from './mentions';

const asha = { userId: 'u-asha', name: 'Asha' };
const ashaV = { userId: 'u-ashav', name: 'Asha Verma' };
const ravi = { userId: 'u-ravi', name: 'रवि' };

describe('finding mentions', () => {
  it('finds each @Name, the longest name first, with UTF-16 offsets', () => {
    expect(findMentions('hi @Asha Verma and @Asha!', [asha, ashaV], false)).toEqual({
      mentions: [
        { userId: 'u-ashav', offset: 3, length: 11 },
        { userId: 'u-asha', offset: 19, length: 5 },
      ],
      mentionsEveryone: false,
    });
  });

  it('works in Hindi, and ignores e-mail addresses and half names', () => {
    expect(findMentions('नमस्ते @रवि', [ravi], false).mentions).toEqual([
      { userId: 'u-ravi', offset: 7, length: 4 },
    ]);
    expect(findMentions('mail asha@Asha.com', [asha], false).mentions).toEqual([]);
    expect(findMentions('@Ashanti', [asha], false).mentions).toEqual([]);
  });

  it('counts @everyone only where allowed', () => {
    expect(findMentions('@everyone look', [asha], true).mentionsEveryone).toBe(true);
    expect(findMentions('@everyone look', [asha], false).mentionsEveryone).toBe(false);
    expect(findMentions('@everyones', [asha], true).mentionsEveryone).toBe(false);
  });
});

describe('typing a mention', () => {
  it('knows the query after an @ before the caret', () => {
    expect(mentionQuery('hi @As', 6)).toEqual({ start: 3, query: 'As' });
    expect(mentionQuery('hi @Asha V', 10)).toEqual({ start: 3, query: 'Asha V' });
    expect(mentionQuery('hi @', 4)).toEqual({ start: 3, query: '' });
    expect(mentionQuery('mail a@b', 8)).toBeNull();
    expect(mentionQuery('@a\nb', 4)).toBeNull();
    expect(mentionQuery('no at', 5)).toBeNull();
  });

  it('puts the name in, with the caret after it', () => {
    expect(insertMention('hi @As ok', 3, 6, 'Asha Verma')).toEqual({
      value: 'hi @Asha Verma  ok',
      caret: 15,
    });
  });
});

describe('showing mentions', () => {
  it('names each stored mention, and whether that person is still here', () => {
    const text = 'ask @Asha and @Ravi';
    const mentions = [
      { userId: 'u-asha', offset: 4, length: 5 },
      { userId: 'u-gone', offset: 14, length: 5 },
      { userId: 'u-bad', offset: 0, length: 3 },
    ];
    expect(mentionSpans(text, mentions, (id) => id === 'u-asha')).toEqual([
      { text: '@Asha', userId: 'u-asha', active: true },
      { text: '@Ravi', userId: 'u-gone', active: false },
    ]);
  });
});
