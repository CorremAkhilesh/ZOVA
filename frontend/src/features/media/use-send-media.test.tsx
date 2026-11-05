import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { HttpResponse, http, server } from '@/test/msw';
import { useSendMedia } from './use-send-media';

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(() => useSendMedia('c1'), { wrapper });
}

describe('the file size limit', () => {
  it('comes from the server', async () => {
    server.use(
      http.get('*/v1/config', () =>
        HttpResponse.json({ media: { maxFileBytes: 5 * 1024 * 1024 } }),
      ),
    );
    const { result } = setup();
    await waitFor(() => expect(result.current.maxBytes).toBe(5 * 1024 * 1024));
  });

  it('stays unknown if the server cannot be asked, so nothing is refused on a guess', async () => {
    let asked = false;
    server.use(
      http.get('*/v1/config', () => {
        asked = true;
        return HttpResponse.error();
      }),
    );
    const { result } = setup();
    await waitFor(() => expect(asked).toBe(true));
    expect(result.current.maxBytes).toBeNull();
  });
});
