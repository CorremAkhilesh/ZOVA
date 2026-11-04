import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildTimeline } from '../chat-utils';
import { type ChatMessage, ME } from '../types';
import { MessageBubble } from './MessageBubble';

const at = (minutes: number) => new Date(2026, 10, 4, 10, minutes);
const message = (
  id: string,
  authorId: string,
  authorName: string,
  minutes: number,
): ChatMessage => ({
  id,
  chatId: 'c',
  authorId,
  authorName,
  text: id,
  at: at(minutes),
});

const GROUP: ChatMessage[] = [
  message('riya 1', 'riya', 'Riya Sen', 0),
  message('riya 2', 'riya', 'Riya Sen', 1),
  message('riya 3', 'riya', 'Riya Sen', 2),
  message('vikram 1', 'vikram', 'Vikram Rao', 3),
  { ...message('mine', ME, 'Me', 4), status: 'sent' },
  message('riya 4', 'riya', 'Riya Sen', 30),
];

function renderThread(messages: ChatMessage[], isGroup: boolean) {
  render(
    <ol aria-label="Thread">
      {buildTimeline(messages).map((item) =>
        item.type === 'date' ? null : (
          <li key={item.key}>
            <MessageBubble
              message={item.message}
              firstInGroup={item.firstInGroup}
              lastInGroup={item.lastInGroup}
              isGroup={isGroup}
            />
          </li>
        ),
      )}
    </ol>,
  );
  return within(screen.getByRole('list', { name: 'Thread' }));
}

const labels = (thread: ReturnType<typeof renderThread>, name: string) =>
  thread.getAllByText(name).filter((element) => /text-sender[1-8]/.test(element.className));

describe('group conversation rendering', () => {
  it('shows each sender name once per group, colored per sender', () => {
    const thread = renderThread(GROUP, true);
    // Two Riya groups: the first three messages, and the one 28 minutes later.
    expect(labels(thread, 'Riya Sen')).toHaveLength(2);
    expect(labels(thread, 'Vikram Rao')).toHaveLength(1);
    const [first, second] = labels(thread, 'Riya Sen');
    expect(first?.className).toBe(second?.className);
  });

  it('puts the tail and the avatar only on the last bubble of a group', () => {
    const thread = renderThread(GROUP, true);
    const item = (text: string) => {
      const found = thread.getByText(text).closest('li');
      if (!found) throw new Error(`no bubble for ${text}`);
      return within(found);
    };
    expect(item('riya 1').queryByTestId('bubble-tail')).not.toBeInTheDocument();
    expect(item('riya 1').queryByText('RS')).not.toBeInTheDocument();
    expect(item('riya 3').getByTestId('bubble-tail')).toBeInTheDocument();
    expect(item('riya 3').getByText('RS')).toBeInTheDocument();
  });

  it('shows no sender names or avatars in 1:1 chats', () => {
    const thread = renderThread(GROUP.slice(0, 2), false);
    expect(screen.getByRole('list').querySelectorAll('[class*="text-sender"]')).toHaveLength(0);
    expect(thread.queryByText('RS')).not.toBeInTheDocument();
  });
});
