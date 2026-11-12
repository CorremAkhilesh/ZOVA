import { type Poll, pollInputSchema } from '@zuvo/protocol';
import { describe, expect, it } from 'vitest';
import { checkPoll, myChoice, nextChoice, pendingPoll, pollResults, withChoice } from './logic';

const poll = (overrides: Partial<Poll> = {}): Poll => ({
  question: 'Lunch?',
  options: [
    { id: '0', text: 'Pizza', voterIds: ['a', 'b', 'me'] },
    { id: '1', text: 'Dosa', voterIds: ['c'] },
    { id: '2', text: 'Salad', voterIds: [] },
  ],
  multiple: false,
  closedAt: null,
  ...overrides,
});

describe('checkPoll', () => {
  const draft = (options: string[], question = 'Lunch?') => ({ question, options, multiple: true });

  it('trims, drops blank options and matches the protocol', () => {
    const result = checkPoll(draft([' Pizza ', '', 'Dosa  ']));
    expect(result).toEqual({
      poll: { question: 'Lunch?', options: ['Pizza', 'Dosa'], multiple: true },
    });
    if ('poll' in result) expect(pollInputSchema.safeParse(result.poll).success).toBe(true);
  });

  it('needs a question and two options', () => {
    expect(checkPoll(draft(['a', 'b'], '  '))).toEqual({
      problem: { field: 'question', code: 'required' },
    });
    expect(checkPoll(draft(['a', '  ']))).toEqual({
      problem: { field: 'options', code: 'tooFew' },
    });
  });

  it('points at an option that repeats another, ignoring case and spaces', () => {
    expect(checkPoll(draft(['Pizza', '', ' pizza']))).toEqual({
      problem: { field: 'options', code: 'duplicate', index: 2 },
    });
  });

  it('refuses more than 12 options and over-long text', () => {
    const many = Array.from({ length: 13 }, (_, index) => `o${index}`);
    expect(checkPoll(draft(many))).toEqual({ problem: { field: 'options', code: 'tooMany' } });
    expect(checkPoll(draft(['a', 'b'], 'x'.repeat(301)))).toEqual({
      problem: { field: 'question', code: 'tooLong' },
    });
    expect(checkPoll(draft(['a', 'b'.repeat(101)]))).toEqual({
      problem: { field: 'options', code: 'tooLong' },
    });
  });
});

describe('choosing', () => {
  it('one answer: replaces my choice, and tapping it again removes it', () => {
    expect(myChoice(poll(), 'me')).toEqual(['0']);
    expect(nextChoice(poll(), 'me', '1')).toEqual(['1']);
    expect(nextChoice(poll(), 'me', '0')).toEqual([]);
    expect(nextChoice(poll(), 'new', '2')).toEqual(['2']);
  });

  it('several answers: each tap toggles that option, in option order', () => {
    const several = poll({ multiple: true });
    expect(nextChoice(several, 'me', '2')).toEqual(['0', '2']);
    expect(nextChoice(several, 'me', '0')).toEqual([]);
  });

  it('shows my choice at once in the local copy', () => {
    const after = withChoice(poll(), 'me', ['1']);
    expect(after.options.map((option) => option.voterIds)).toEqual([['a', 'b'], ['c', 'me'], []]);
  });
});

describe('results', () => {
  it('counts each option and the percent of everyone who voted', () => {
    expect(pollResults(poll())).toEqual({
      voters: 4,
      options: [
        { id: '0', text: 'Pizza', count: 3, percent: 75 },
        { id: '1', text: 'Dosa', count: 1, percent: 25 },
        { id: '2', text: 'Salad', count: 0, percent: 0 },
      ],
    });
    expect(pollResults(poll({ options: [] })).voters).toBe(0);
  });

  it('numbers a new poll’s options the way the server does', () => {
    expect(pendingPoll({ question: 'Q', options: ['a', 'b'], multiple: false }).options).toEqual([
      { id: '0', text: 'a', voterIds: [] },
      { id: '1', text: 'b', voterIds: [] },
    ]);
  });
});
