import type { Mention } from '@zuvo/protocol';

export interface MentionCandidate {
  userId: string;
  name: string;
}

export const EVERYONE = 'everyone';

/** An @ starts a mention only at the start or after whitespace or an opening bracket. */
const startsWord = (text: string, at: number) => at === 0 || /[\s([{"'«]/u.test(text[at - 1] ?? '');
/** …and ends at the end, whitespace or punctuation. */
const endsWord = (text: string, at: number) =>
  at >= text.length || /[\s.,!?:;)\]}"'»]/u.test(text[at] ?? '');

/**
 * The mentions in a message: every "@Name" of someone who may be mentioned, longest names first so
 * "@Asha Verma" wins over "@Asha", plus whether "@everyone" is there (when it is allowed).
 */
export function findMentions(
  text: string,
  candidates: MentionCandidate[],
  everyoneAllowed: boolean,
): { mentions: Mention[]; mentionsEveryone: boolean } {
  const byLength = [...candidates].sort((a, b) => b.name.length - a.name.length);
  const mentions: Mention[] = [];
  let mentionsEveryone = false;
  let at = text.indexOf('@');
  while (at !== -1) {
    let next = at + 1;
    if (startsWord(text, at)) {
      const rest = text.slice(at + 1);
      if (
        everyoneAllowed &&
        rest.startsWith(EVERYONE) &&
        endsWord(text, at + 1 + EVERYONE.length)
      ) {
        mentionsEveryone = true;
        next = at + 1 + EVERYONE.length;
      } else {
        const found = byLength.find(
          (candidate) =>
            candidate.name.length > 0 &&
            rest.startsWith(candidate.name) &&
            endsWord(text, at + 1 + candidate.name.length),
        );
        if (found) {
          mentions.push({ userId: found.userId, offset: at, length: found.name.length + 1 });
          next = at + 1 + found.name.length;
        }
      }
    }
    at = text.indexOf('@', next);
  }
  return { mentions, mentionsEveryone };
}

/**
 * What is being typed after an @ just before the caret, for the member picker, or null. Names have
 * spaces, so a query may too, but not a line break, and not more than a long name's worth.
 */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const at = before.lastIndexOf('@');
  if (at === -1 || !startsWord(text, at)) return null;
  const query = before.slice(at + 1);
  if (query.length > 40 || /[\n@]/u.test(query) || /\s{2}/u.test(query)) return null;
  return { start: at, query };
}

/** Puts "@Name " in place of what was typed after the @, with the caret after it. */
export function insertMention(text: string, start: number, caret: number, name: string) {
  const inserted = `@${name} `;
  return {
    value: `${text.slice(0, start)}${inserted}${text.slice(caret)}`,
    caret: start + inserted.length,
  };
}

/** The "@Name"s of a message as stored, for showing them: text, who, and whether still a member. */
export function mentionSpans(
  text: string,
  mentions: Mention[] | undefined,
  isMember: (userId: string) => boolean,
) {
  return (mentions ?? []).flatMap((mention) => {
    const shown = text.slice(mention.offset, mention.offset + mention.length);
    return shown.startsWith('@')
      ? [{ text: shown, userId: mention.userId, active: isMember(mention.userId) }]
      : [];
  });
}
