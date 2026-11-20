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
    // The same message every time, as the server would send it again (same key on this device).
    clientMsgId: '019a0000-0000-7000-8000-000000000001',
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
export function servePolls(
  start: Poll,
  options: { refuseVotes?: boolean; senderId?: string } = {},
) {
  const state = { poll: start, votes: [] as string[][], closed: 0 };
  const senderId = options.senderId ?? 'u-asha';
  const answer = () => HttpResponse.json({ message: pollMessage(state.poll, { senderId }) });
  server.use(
    http.put('*/v1/chats/:id/messages/:messageId/vote', async ({ request }) => {
      const { optionIds } = (await request.json()) as { optionIds: string[] };
      state.votes.push(optionIds);
      if (options.refuseVotes) {
        return HttpResponse.json(
          { code: 'POLL_CLOSED', message: 'This poll is closed.', requestId: 'r' },
          { status: 409 },
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
    // After a refusal the app asks how the poll really is.
    http.get('*/v1/chats/:id/messages', () =>
      HttpResponse.json({ items: [pollMessage(state.poll, { senderId })], hasMore: false }),
    ),
    http.get('*/v1/chats/:id', () => HttpResponse.json({ chat: pollChat() })),
    http.get('*/v1/statuses', () => HttpResponse.json({ mine: [], people: [] })),
    http.post('*/v1/chats/:id/messages/:messageId/close-poll', () => {
      state.closed += 1;
      state.poll = { ...state.poll, closedAt: new Date().toISOString() };
      return answer();
    }),
  );
  return state;
}
