import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { setSignedIn } from '@/features/auth/session';
import { type ChatMessage, ME } from '@/features/chats/types';
import { sessionFixture } from '@/test/msw';
import { useMessageUi } from './store';
import { useBubbleGestures } from './use-bubble-gestures';

const mine: ChatMessage = {
  id: 'm1',
  chatId: 'c1',
  serverId: 's1',
  seq: 3,
  text: 'my own words',
  at: new Date('2026-01-01T10:00:00Z'),
  authorId: ME,
  authorName: 'You',
};

describe('useBubbleGestures', () => {
  afterEach(() => useMessageUi.setState({ replies: {} }));

  it('replies to my own message as me, from the session the app already has', () => {
    const queryClient = new QueryClient();
    setSignedIn(queryClient, sessionFixture());
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useBubbleGestures(mine, [mine]), { wrapper });

    act(() => result.current.reply());

    const { user } = sessionFixture();
    expect(useMessageUi.getState().replies.c1).toMatchObject({
      id: 's1',
      senderId: user.id,
      senderName: user.displayName,
      text: 'my own words',
    });
  });
});
