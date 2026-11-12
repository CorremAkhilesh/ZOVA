import type { Message, Poll } from '@zuvo/protocol';
import { chatFixture, ME_ID, messageFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';

export const pollFixture = (overrides: Partial<Poll> = {}): Poll => ({
  question: 'Lunch?',
  options: [
    { id: '0', text: 'Pizza', voterIds: ['u-asha', 'u-ravi', 'u-meera'] },
    { id: '1', text: 'Dosa', voterIds: ['u-dev'] },
    { id: '2', text: 'Salad', voterIds: [] },
  ],
  multiple: false,
  closedAt: null,
  ...overrides,
});

export const pollMessage = (poll: Poll, overrides: Partial<Message> = {}): Message =>
  messageFixture(1, {
    type: 'poll',
    text: null,
    poll,
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  });

export const pollChat = (overrides: Parameters<typeof chatFixture>[0] = {}) =>
  chatFixture({
    seq: 1,
    lastMessage: {
      id: 'm1',
      seq: 1,
      senderId: 'u-asha',
      type: 'poll',
      preview: 'Lunch?',
      createdAt: new Date(Date.now() - 60_000).toISOString(),
    },
    ...overrides,
  });

/** Test-only: voting and closing, as the server would answer them. Records each request. */
export function servePolls(start: Poll, options: { failVotes?: boolean } = {}) {
  const state = { poll: start, votes: [] as string[][], closed: 0 };
  const answer = () =>
    HttpResponse.json({ message: pollMessage(state.poll, { senderId: 'u-asha' }) });
  server.use(
    http.put('*/v1/chats/:id/messages/:messageId/vote', async ({ request }) => {
      const { optionIds } = (await request.json()) as { optionIds: string[] };
      state.votes.push(optionIds);
      if (options.failVotes) {
        return HttpResponse.json(
          { code: 'INTERNAL_ERROR', message: 'x', requestId: 'r' },
          { status: 500 },
        );
      }
      state.poll = {
        ...state.poll,
        options: state.poll.options.map((option) => {
          const others = option.voterIds.filter((id) => id !== ME_ID);
          return {
            ...option,
            voterIds: optionIds.includes(option.id) ? [...others, ME_ID] : others,
          };
        }),
      };
      return answer();
    }),
    http.post('*/v1/chats/:id/messages/:messageId/close-poll', () => {
      state.closed += 1;
      state.poll = { ...state.poll, closedAt: new Date().toISOString() };
      return answer();
    }),
  );
  return state;
}
