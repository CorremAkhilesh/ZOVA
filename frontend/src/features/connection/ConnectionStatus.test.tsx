import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useSyncStore } from '@/features/sync/store';
import { axe } from '@/test/axe';
import { chatFixture } from '@/test/chat-fixtures';
import { DESKTOP_WIDTH, MOBILE_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { lastSocket } from '@/test/socket-mock';
import { ConnectionStatus } from './ConnectionStatus';

function renderStatus() {
  return render(
    <TooltipProvider>
      <ConnectionStatus />
    </TooltipProvider>,
  );
}

describe('ConnectionStatus', () => {
  it('shows "connecting" until the socket connects', () => {
    renderStatus();
    expect(screen.getByRole('status')).toHaveTextContent('Connecting…');
  });

  it('shows no pill when connected (only a screen-reader status)', () => {
    useSyncStore.setState({ socket: 'connected' });
    renderStatus();
    expect(screen.getByText('Connected')).toHaveClass('sr-only');
    expect(screen.queryByText('Connecting…')).not.toBeInTheDocument();
  });

  it('follows the socket when it drops and returns', () => {
    useSyncStore.setState({ socket: 'connected' });
    renderStatus();
    act(() => useSyncStore.setState({ socket: 'connecting' }));
    expect(screen.getByRole('status')).toHaveTextContent('Connecting…');
    act(() => useSyncStore.setState({ socket: 'connected' }));
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('shows "Offline" when the browser goes offline', () => {
    useSyncStore.setState({ socket: 'connected' });
    renderStatus();
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(screen.getByText('Offline')).toBeInTheDocument();
    onLine.mockRestore();
  });

  it('shows "Can’t reach server" when online but the socket keeps failing', () => {
    useSyncStore.setState({ socket: 'unreachable' });
    renderStatus();
    const pill = screen.getByText('Can’t reach server');
    expect(screen.queryByText('Offline')).not.toBeInTheDocument();
    expect(pill).toHaveAttribute('role', 'status');
    // Focusable trigger for the explanatory tooltip.
    expect(pill.closest('button')).toBeInTheDocument();
  });

  it('shows inside a conversation on phones, where the chat list is hidden', async () => {
    await seedLocal([chatFixture()]);
    await renderApp('/chats/c1', { width: MOBILE_WIDTH });
    expect(await screen.findByText('Connecting…')).toBeInTheDocument();
    await waitFor(() => expect(useSyncStore.getState().client).not.toBeNull());
    act(() => lastSocket().receive('connect'));
    expect(await screen.findByText('Connected')).toHaveClass('sr-only');
    act(() => lastSocket().receive('disconnect', 'transport close'));
    expect(await screen.findByText('Connecting…')).toBeInTheDocument();
  });

  it('corrects itself if the socket dropped without an event', async () => {
    await seedLocal([chatFixture()]);
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    await waitFor(() => expect(useSyncStore.getState().client).not.toBeNull());
    act(() => lastSocket().receive('connect'));
    expect(await screen.findByText('Connected')).toBeInTheDocument();
    lastSocket().connected = false;
    expect(await screen.findByText('Connecting…', {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it('a stopped client cannot change what the pill shows', async () => {
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    await waitFor(() => expect(useSyncStore.getState().client).not.toBeNull());
    const old = lastSocket();
    useSyncStore.getState().client?.stop();
    useSyncStore.setState({ socket: 'connected' });
    act(() => old.receive('connect_error', new Error('late')));
    expect(useSyncStore.getState().socket).toBe('connected');
  });
});

describe('diagnostics', () => {
  it('shows socket, handshake error, outbox state and cursor, with no message text', async () => {
    const db = await seedLocal([chatFixture()]);
    await db.outbox.add({
      clientMsgId: '0190a000-0000-7000-8000-000000000004',
      chatId: 'c1',
      text: 'a secret',
      attempts: 2,
      state: 'pending',
    });
    const user = userEvent.setup();
    const { container } = await renderApp('/settings', { width: DESKTOP_WIDTH });
    await waitFor(() => expect(useSyncStore.getState().client).not.toBeNull());
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    act(() =>
      lastSocket().receive(
        'connect_error',
        Object.assign(new Error('x'), { data: { code: 'SESSION_EXPIRED' } }),
      ),
    );
    logged.mockRestore();
    await user.click(await screen.findByText('Diagnostics'));
    expect(await screen.findByText('SESSION_EXPIRED')).toBeInTheDocument();
    expect(await screen.findByText(/#1 pending \(2\)/)).toBeInTheDocument();
    expect(await screen.findByText('5')).toBeInTheDocument();
    expect(container).not.toHaveTextContent('a secret');
    expect(await axe(container)).toHaveNoViolations();
  });
});
