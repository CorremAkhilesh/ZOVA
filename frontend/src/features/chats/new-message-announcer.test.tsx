import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NewMessageAnnouncer } from './components/NewMessageAnnouncer';
import { type ChatMessage, ME } from './types';

const message = (id: string, overrides: Partial<ChatMessage> = {}): ChatMessage => ({
  id,
  chatId: 'c1',
  authorId: 'u-asha',
  authorName: 'Asha Verma',
  text: `text ${id}`,
  at: new Date('2026-11-05T10:00:00Z'),
  ...overrides,
});

const region = (container: HTMLElement) => container.querySelector('[aria-live="polite"]');

describe('NewMessageAnnouncer', () => {
  it('stays quiet for what is already there, then reads out a new message from someone else', () => {
    const first = [message('m1')];
    const { container, rerender } = render(<NewMessageAnnouncer messages={first} />);
    expect(region(container)).toHaveTextContent('');
    rerender(<NewMessageAnnouncer messages={[...first, message('m2', { text: '*Hi* there' })]} />);
    expect(region(container)).toHaveTextContent('New message from Asha Verma: Hi there');
  });

  it('says nothing for my own messages, and names the sender of a photo', () => {
    const first = [message('m1')];
    const { container, rerender } = render(<NewMessageAnnouncer messages={first} />);
    rerender(<NewMessageAnnouncer messages={[...first, message('m2', { authorId: ME })]} />);
    expect(region(container)).toHaveTextContent('');
    rerender(
      <NewMessageAnnouncer
        messages={[...first, message('m2', { authorId: ME }), message('m3', { text: '' })]}
      />,
    );
    expect(region(container)).toHaveTextContent('New message from Asha Verma');
  });
});
