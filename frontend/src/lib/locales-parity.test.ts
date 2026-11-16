import { describe, expect, it } from 'vitest';
import helpEn from '@/features/help/locales/en.json';
import helpHi from '@/features/help/locales/hi.json';
import en from '@/locales/en.json';
import hi from '@/locales/hi.json';

type Tree = { [key: string]: unknown };

/** Every leaf string by its dotted path (arrays too: their keys are "0", "1", …). */
function leaves(tree: unknown, prefix = '', out = new Map<string, string>()) {
  if (typeof tree === 'string') out.set(prefix, tree);
  else if (tree && typeof tree === 'object')
    for (const [key, value] of Object.entries(tree as Tree))
      leaves(value, prefix ? `${prefix}.${key}` : key, out);
  return out;
}

/** Hindi uses the same i18next plural forms as English (_one, _other). */
const PLURAL = /_(zero|one|two|few|many|other)$/;
const base = (key: string) => key.replace(PLURAL, '');
/** Hindi spells these out instead of inserting the English value (the brand's English tagline). */
const TRANSLATED_IN_PLACE = new Set(['welcome.subtitle']);
const placeholders = (text: string) =>
  [...text.matchAll(/{{\s*([\w.]+)\s*}}/g)].map((m) => m[1]).sort();

describe.each([
  ['app', en, hi],
  ['help', helpEn, helpHi],
])('%s strings: English and Hindi match', (_name, english, hindi) => {
  const enLeaves = leaves(english);
  const hiLeaves = leaves(hindi);

  it('have the same keys', () => {
    expect([...hiLeaves.keys()].filter((key) => !enLeaves.has(key))).toEqual([]);
    expect([...enLeaves.keys()].filter((key) => !hiLeaves.has(key))).toEqual([]);
  });

  it('use the same {{placeholders}} (count only where a plural form needs it)', () => {
    const mismatched = [...enLeaves].flatMap(([key, text]) => {
      const other = hiLeaves.get(key);
      if (other === undefined || TRANSLATED_IN_PLACE.has(key)) return [];
      const want = placeholders(text).filter((p) => !(PLURAL.test(key) && p === 'count'));
      const got = placeholders(other).filter((p) => !(PLURAL.test(key) && p === 'count'));
      return [...new Set(want)].join() === [...new Set(got)].join() ? [] : [base(key)];
    });
    expect(mismatched).toEqual([]);
  });

  it('have no empty Hindi strings', () => {
    expect([...hiLeaves].filter(([, text]) => text.trim() === '').map(([key]) => key)).toEqual([]);
  });
});
