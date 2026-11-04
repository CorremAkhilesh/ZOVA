import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { delay } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { HttpResponse, http, server } from '@/test/msw';
import { ConnectionStatus } from './ConnectionStatus';

function renderStatus() {
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider>
        <ConnectionStatus />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

describe('ConnectionStatus', () => {
  it('shows "connecting" while the health check is in flight', async () => {
    server.use(
      http.get('*/v1/health', async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    renderStatus();
    expect(await screen.findByRole('status')).toHaveTextContent('Connecting…');
  });

  it('shows no pill when connected (only a screen-reader status)', async () => {
    renderStatus();
    const status = await screen.findByText('Connected');
    expect(status).toHaveClass('sr-only');
    expect(screen.queryByText('Connecting…')).not.toBeInTheDocument();
    expect(screen.queryByText('Offline')).not.toBeInTheDocument();
  });

  it('shows "Offline" when the browser goes offline', async () => {
    renderStatus();
    await screen.findByText('Connected');
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    expect(await screen.findByText('Offline')).toBeInTheDocument();
    onLine.mockRestore();
  });

  it('shows "server unreachable" when /v1/health fails', async () => {
    server.use(
      http.get('*/v1/health', () =>
        HttpResponse.json(
          { code: 'SERVICE_UNAVAILABLE', message: 'Down', requestId: 'r' },
          { status: 503 },
        ),
      ),
    );
    renderStatus();
    // healthQuery retries once before reporting the error.
    const pill = await screen.findByText('Offline', {}, { timeout: 4000 });
    expect(pill).toHaveAttribute('role', 'status');
    // Focusable trigger for the explanatory tooltip.
    expect(pill.closest('button')).toBeInTheDocument();
  });
});
