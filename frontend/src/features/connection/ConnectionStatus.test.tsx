import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useSyncStore } from '@/features/sync/store';
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
});
