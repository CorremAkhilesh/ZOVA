import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ScheduledMessage } from '@zuvo/protocol';
import type { ReactNode } from 'react';
import { Toaster } from 'sonner';
import { vi } from 'vitest';
import { HttpResponse, http, server } from '@/test/msw';

/** Test-only: India's time zone, whatever the machine running the tests uses. */
export function fixZone(zone: string) {
  const real = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
    this: Intl.DateTimeFormat,
  ) {
    return { ...real.call(this), timeZone: zone };
  });
}

export const scheduledFixture = (overrides: Partial<ScheduledMessage> = {}): ScheduledMessage => ({
  id: 's1',
  chatId: 'c1',
  text: 'Happy birthday!',
  media: null,
  sendAt: '2026-11-20T03:30:00.000Z',
  status: 'pending',
  failure: null,
  messageId: null,
  createdAt: '2026-11-12T04:00:00.000Z',
  updatedAt: '2026-11-12T04:00:00.000Z',
  ...overrides,
});

export interface ScheduledServer {
  items: ScheduledMessage[];
  requests: Array<{ method: string; path: string; body: unknown }>;
}

/** Test-only: the scheduled-messages API kept in memory, recording what the app sends. */
export function serveScheduled(initial: ScheduledMessage[]): ScheduledServer {
  const state: ScheduledServer = { items: [...initial], requests: [] };
  const record = async (request: Request) => {
    const text = await request.text();
    const body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
    state.requests.push({ method: request.method, path: new URL(request.url).pathname, body });
    return body;
  };
  const find = (id: unknown) => state.items.find((item) => item.id === id) as ScheduledMessage;
  server.use(
    http.get('*/v1/me/scheduled', () => HttpResponse.json({ items: state.items })),
    http.post('*/v1/me/scheduled', async ({ request }) => {
      const body = (await record(request)) as { chatId: string; text: string; sendAt: string };
      const item = scheduledFixture({ id: `s${state.items.length + 10}`, ...body });
      state.items.push(item);
      return HttpResponse.json({ item });
    }),
    http.patch('*/v1/me/scheduled/:id', async ({ request, params }) => {
      const changes = (await record(request)) ?? {};
      const item = { ...find(params.id), ...changes };
      state.items = state.items.map((each) => (each.id === item.id ? item : each));
      return HttpResponse.json({ item });
    }),
    http.post('*/v1/me/scheduled/:id/send-now', async ({ request, params }) => {
      await record(request);
      const item = { ...find(params.id), status: 'sent' as const };
      state.items = state.items.filter((each) => each.id !== item.id);
      return HttpResponse.json({ item });
    }),
    http.delete('*/v1/me/scheduled/:id', async ({ request, params }) => {
      await record(request);
      state.items = state.items.filter((each) => each.id !== params.id);
      return HttpResponse.json({ ok: true });
    }),
  );
  return state;
}

export const refuse = (method: 'post' | 'patch', path: string, status: number, code: string) =>
  server.use(
    http[method](path, () =>
      HttpResponse.json({ code, message: 'No.', requestId: 'r' }, { status }),
    ),
  );

/** A component on its own, with a fresh query client and the toasts. */
export function renderAlone(ui: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      {ui}
      <Toaster />
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}
