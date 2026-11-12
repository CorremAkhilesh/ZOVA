import { z } from 'zod';

export const POLL_QUESTION_MAX = 300;
export const POLL_OPTION_MAX = 100;
export const POLL_OPTIONS_MIN = 2;
export const POLL_OPTIONS_MAX = 12;

const pollTextSchema = (max: number) => z.string().trim().min(1).max(max);

/** What the sender writes. Options must differ (ignoring case and spaces at the ends). */
export const pollInputSchema = z
  .object({
    question: pollTextSchema(POLL_QUESTION_MAX),
    options: z.array(pollTextSchema(POLL_OPTION_MAX)).min(POLL_OPTIONS_MIN).max(POLL_OPTIONS_MAX),
    /** True: each person may pick several options. */
    multiple: z.boolean(),
  })
  .refine(
    (poll) =>
      new Set(poll.options.map((option) => option.toLocaleLowerCase())).size ===
      poll.options.length,
    { message: 'Options must be different', path: ['options'] },
  );

export const pollOptionSchema = z.object({
  /** "0", "1"…: stable for the life of the poll. */
  id: z.string(),
  text: z.string(),
  /** Everyone who may see the poll sees who voted for what. */
  voterIds: z.array(z.string()),
});

/** On a message of type `poll`. */
export const pollSchema = z.object({
  question: z.string(),
  options: z.array(pollOptionSchema),
  multiple: z.boolean(),
  /** Set when its creator closed it: no more votes. */
  closedAt: z.string().nullable(),
});

/**
 * PUT /v1/chats/:id/messages/:messageId/vote: my whole choice, replacing the last one. Empty removes
 * my vote. One option at most unless the poll allows several. The answer is the message.
 */
export const votePollBodySchema = z.object({
  optionIds: z.array(z.string().max(4)).max(POLL_OPTIONS_MAX),
});

export type PollInput = z.infer<typeof pollInputSchema>;
export type Poll = z.infer<typeof pollSchema>;
export type PollOption = z.infer<typeof pollOptionSchema>;
