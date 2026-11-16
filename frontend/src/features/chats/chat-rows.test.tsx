import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatRows } from './components/ChatRows';
import type { ChatSummary } from './types';

// The rows themselves have their own tests; here only which of them are in the page matters.
vi.mock('./components/ChatListItem', () => ({
  ChatListItem: ({ chat }: { chat: ChatSummary }) => <span>{chat.name}</span>,
}));

const chats = Array.from(
  { length: 500 },
  (_, index) => ({ id: `chat-${index + 1}`, name: `Colleague ${index + 1}` }) as ChatSummary,
);

/** A 700 px tall scroller with 70 px rows (jsdom lays nothing out by itself). */
function scrollerOf(height: number) {
  const element = document.createElement('div');
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: height });
  document.body.append(element);
  return element;
}

describe('ChatRows', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLLIElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => 70,
    });
  });
  afterEach(() => {
    Reflect.deleteProperty(HTMLLIElement.prototype, 'offsetHeight');
    document.body.replaceChildren();
  });

  it('puts only the rows near the viewport in the page, however many chats there are', () => {
    const element = scrollerOf(700);
    render(<ChatRows chats={chats} scroller={{ current: element }} />, { container: element });

    const rows = screen.getAllByRole('listitem');
    // 10 visible + overscan, nowhere near 500.
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(rows.length).toBeLessThan(30);
    expect(screen.getByText('Colleague 1')).toBeInTheDocument();
    expect(screen.queryByText('Colleague 500')).not.toBeInTheDocument();
    // The whole list's height is kept, so the scrollbar is honest.
    expect(screen.getByTestId('chat-rows').style.height).toBe(`${500 * 70}px`);
  });

  it('tells assistive technology where each row is in the whole list', () => {
    const element = scrollerOf(700);
    render(<ChatRows chats={chats} scroller={{ current: element }} />, { container: element });

    const first = screen.getAllByRole('listitem')[0];
    expect(first).toHaveAttribute('aria-setsize', '500');
    expect(first).toHaveAttribute('aria-posinset', '1');
  });
});
