import {
  POLL_OPTION_MAX,
  POLL_OPTIONS_MAX,
  POLL_OPTIONS_MIN,
  POLL_QUESTION_MAX,
  type Poll,
  type PollInput,
} from '@zuvo/protocol';

export { POLL_OPTION_MAX, POLL_OPTIONS_MAX, POLL_OPTIONS_MIN, POLL_QUESTION_MAX };

export interface PollDraft {
  question: string;
  options: string[];
  multiple: boolean;
}

export type PollProblem =
  | { field: 'question'; code: 'required' | 'tooLong' }
  | { field: 'options'; code: 'tooFew' | 'tooMany' | 'tooLong' }
  | { field: 'options'; code: 'duplicate'; index: number };

/** The same rules as the protocol, as something the form can point at. Blank options are dropped. */
export function checkPoll(draft: PollDraft): { poll: PollInput } | { problem: PollProblem } {
  const question = draft.question.trim();
  if (!question) return { problem: { field: 'question', code: 'required' } };
  if (question.length > POLL_QUESTION_MAX) {
    return { problem: { field: 'question', code: 'tooLong' } };
  }
  const options = draft.options.map((option) => option.trim()).filter(Boolean);
  if (options.length < POLL_OPTIONS_MIN) return { problem: { field: 'options', code: 'tooFew' } };
  if (options.length > POLL_OPTIONS_MAX) return { problem: { field: 'options', code: 'tooMany' } };
  if (options.some((option) => option.length > POLL_OPTION_MAX)) {
    return { problem: { field: 'options', code: 'tooLong' } };
  }
  // `index` is the field's place in the form, blank ones included, so the form can mark it.
  const seen = new Set<string>();
  for (const [index, option] of draft.options.entries()) {
    const folded = option.trim().toLocaleLowerCase();
    if (!folded) continue;
    if (seen.has(folded)) return { problem: { field: 'options', code: 'duplicate', index } };
    seen.add(folded);
  }
  return { poll: { question, options, multiple: draft.multiple } };
}

/** The options I picked. */
export const myChoice = (poll: Poll, me: string) =>
  poll.options.filter((option) => option.voterIds.includes(me)).map((option) => option.id);

/**
 * What tapping an option makes my whole choice: one option replaces the other, tapping my only
 * choice again removes my vote, and with several allowed each tap toggles that one.
 */
export function nextChoice(poll: Poll, me: string, optionId: string): string[] {
  const mine = myChoice(poll, me);
  if (poll.multiple) {
    return mine.includes(optionId)
      ? mine.filter((id) => id !== optionId)
      : poll.options
          .map((option) => option.id)
          .filter((id) => id === optionId || mine.includes(id));
  }
  return mine.length === 1 && mine[0] === optionId ? [] : [optionId];
}

/** The poll as it will be once the server has my choice: shown at once, undone on failure. */
export function withChoice(poll: Poll, me: string, optionIds: string[]): Poll {
  return {
    ...poll,
    options: poll.options.map((option) => {
      const others = option.voterIds.filter((id) => id !== me);
      return { ...option, voterIds: optionIds.includes(option.id) ? [...others, me] : others };
    }),
  };
}

export interface OptionResult {
  id: string;
  text: string;
  count: number;
  /** Of everyone who voted, so with several answers allowed they can add up to more than 100. */
  percent: number;
}

export function pollResults(poll: Poll): { voters: number; options: OptionResult[] } {
  const voters = new Set(poll.options.flatMap((option) => option.voterIds)).size;
  return {
    voters,
    options: poll.options.map((option) => ({
      id: option.id,
      text: option.text,
      count: option.voterIds.length,
      percent: voters === 0 ? 0 : Math.round((option.voterIds.length / voters) * 100),
    })),
  };
}

/** How a poll shows until the server has it: the options numbered as the server will number them. */
export const pendingPoll = (input: PollInput): Poll => ({
  question: input.question,
  options: input.options.map((text, index) => ({ id: String(index), text, voterIds: [] })),
  multiple: input.multiple,
  closedAt: null,
});
