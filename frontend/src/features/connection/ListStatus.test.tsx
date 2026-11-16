import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useSyncStore } from '@/features/sync/store';
import { axe } from '@/test/axe';
import { chatFixture, personFixture, syncPage } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { MOBILE_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { ListStatus, UPDATING_DELAY_MS } from './ListStatus';

function renderStatus() {
  return render(
    <TooltipProvider>
      <ListStatus />
    </TooltipProvider>,
  );
}

describe('ListStatus', () => {
  it('says "Updating…" while a sync takes a moment, then nothing once it is done', async () => {
    useSyncStore.setState({ socket: 'connected', sync: 'syncing' });
    const { container } = renderStatus();
    // A quick catch-up shows nothing.
    expect(screen.queryByText('Updating…')).not.toBeInTheDocument();
    expect(await screen.findByText('Updating…')).toHaveAttribute('role', 'status');
    expect(await axe(container)).toHaveNoViolations();

    act(() => useSyncStore.setState({ sync: 'idle' }));
    expect(screen.queryByText('Updating…')).not.toBeInTheDocument();
    expect(screen.getByText('Connected')).toHaveClass('sr-only');
  });

  it('a sync that finishes within the delay never shows', () => {
    vi.useFakeTimers();
    try {
      useSyncStore.setState({ socket: 'connected', sync: 'syncing' });
      renderStatus();
      act(() => vi.advanceTimersByTime(UPDATING_DELAY_MS - 50));
      act(() => useSyncStore.setState({ sync: 'idle' }));
      act(() => vi.advanceTimersByTime(UPDATING_DELAY_MS));
      expect(screen.queryByText('Updating…')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('"Updating…" stands in for "Connecting…" during start-up', async () => {
    useSyncStore.setState({ socket: 'connecting', sync: 'syncing' });
    renderStatus();
    expect(await screen.findByText('Updating…')).toBeInTheDocument();
    expect(screen.queryByText('Connecting…')).not.toBeInTheDocument();
  });

  it('offline and "can’t reach server" win: they explain why nothing updates', async () => {
    useSyncStore.setState({ socket: 'unreachable', sync: 'syncing' });
    renderStatus();
    await act(() => new Promise((resolve) => setTimeout(resolve, UPDATING_DELAY_MS + 50)));
    expect(screen.getByText('Can’t reach server')).toBeInTheDocument();
    expect(screen.queryByText('Updating…')).not.toBeInTheDocument();
  });
});

describe('chat list during the first sync', () => {
  it('shows the stored chats and "Updating…", never a blank list, until the sync is done', async () => {
    await seedLocal([chatFixture({ otherUser: personFixture({ displayName: 'Meera Iyer' }) })]);
    let finish: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      finish = resolve;
    });
    server.use(
      http.get('*/v1/sync', async () => {
        await done;
        return HttpResponse.json(syncPage({ cursor: '5' }));
      }),
    );
    try {
      await renderApp('/chats', { width: MOBILE_WIDTH });
      expect(await screen.findByText('Meera Iyer')).toBeInTheDocument();
      expect(await screen.findByText('Updating…')).toBeInTheDocument();
    } finally {
      finish();
    }
    await waitFor(() => expect(screen.queryByText('Updating…')).not.toBeInTheDocument());
    expect(screen.getByText('Meera Iyer')).toBeInTheDocument();
  });
});
