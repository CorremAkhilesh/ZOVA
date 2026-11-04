import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { delay } from 'msw';
import { describe, expect, it } from 'vitest';
import { HttpResponse, http, server } from '@/test/msw';
import { ConnectionStatus } from './ConnectionStatus';

function renderStatus() {
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <ConnectionStatus />
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

  it('shows "connected" when /v1/health answers', async () => {
    renderStatus();
    expect(await screen.findByText('Connected')).toBeInTheDocument();
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
    expect(await screen.findByText('Server unreachable')).toBeInTheDocument();
  });
});
