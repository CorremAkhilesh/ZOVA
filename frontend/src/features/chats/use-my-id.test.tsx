import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sessionQuery, setSignedIn, useSession } from '@/features/auth/session';
import { sessionFixture } from '@/test/msw';
import { useMyId } from './use-my-id';

function MyId() {
  return <span>{useMyId() ?? 'nobody'}</span>;
}
function SessionUser() {
  return <span>{useSession()?.user.id ?? 'nobody'}</span>;
}

function renderMany(Component: () => ReactNode, count: number) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  setSignedIn(queryClient, sessionFixture());
  const intervals = vi.spyOn(globalThis, 'setInterval');
  const view = render(
    <QueryClientProvider client={queryClient}>
      {Array.from({ length: count }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: identical rows
        <Component key={index} />
      ))}
    </QueryClientProvider>,
  );
  return { queryClient, view, intervals };
}

describe('useMyId', () => {
  afterEach(() => vi.restoreAllMocks());

  it('gives the signed-in user id from the cached session', () => {
    renderMany(MyId, 1);
    expect(screen.getByText(sessionFixture().user.id)).toBeInTheDocument();
  });

  it('starts no poll of its own, however many bubbles ask', () => {
    const { intervals } = renderMany(MyId, 50);
    const sessionPolls = intervals.mock.calls.filter(
      ([, ms]) => ms === sessionQuery.refetchInterval,
    );
    expect(sessionPolls).toHaveLength(0);
  });

  // The difference this hook makes: useSession() starts a timer per component.
  it('where useSession() starts one per component', () => {
    const { intervals } = renderMany(SessionUser, 5);
    const sessionPolls = intervals.mock.calls.filter(
      ([, ms]) => ms === sessionQuery.refetchInterval,
    );
    expect(sessionPolls).toHaveLength(5);
  });
});
