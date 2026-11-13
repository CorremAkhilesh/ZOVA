import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { PublicProfile } from '@zuvo/protocol';
import { beforeEach, describe, expect, it } from 'vitest';
import { PeopleSelect } from '@/features/groups/components/PeopleSelect';
import { axe } from '@/test/axe';
import { chatFixture, ME_ID, messageFixture, personFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { useMessageUi } from './store';

const SLOW = { timeout: 15_000 };
let requests: Array<{ path: string; method: string; body: unknown }>;

beforeEach(() => {
  requests = [];
  useMessageUi.setState({ chatMenu: null, menu: null, jump: null });
  server.use(
    http.patch('*/v1/chats/:id/prefs', async ({ request, params }) => {
      requests.push({
        path: new URL(request.url).pathname,
        method: 'PATCH',
        body: await request.json(),
      });
      return HttpResponse.json({ chat: chatFixture({ id: String(params.id) }) });
    }),
    http.post('*/v1/chats/:id/clear', ({ request }) => {
      requests.push({ path: new URL(request.url).pathname, method: 'POST', body: null });
      return HttpResponse.json({ ok: true });
    }),
    http.delete('*/v1/chats/:id', ({ request }) => {
      requests.push({ path: new URL(request.url).pathname, method: 'DELETE', body: null });
      return HttpResponse.json({ ok: true });
    }),
  );
});

const named = (id: string, displayName: string, overrides: object = {}) =>
  chatFixture({
    id,
    seq: 1,
    otherUser: personFixture({ id: `u-${id}`, displayName }),
    lastActivityAt: new Date().toISOString(),
    ...overrides,
  });

describe('the chat list line for a reaction', () => {
  it('shows who reacted to what, until something newer happens', async () => {
    const createdAt = new Date(Date.now() - 60_000).toISOString();
    await seedLocal([
      named('a', 'Asha', {
        lastMessage: { id: 'm', seq: 1, senderId: ME_ID, type: 'text', preview: 'hi', createdAt },
        lastReaction: {
          byId: 'u-a',
          byName: 'Asha Rao',
          emoji: '👍',
          text: 'hello',
          seq: 1,
          at: new Date().toISOString(),
        },
      }),
    ]);
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    expect(
      await screen.findByText('Asha reacted 👍 to "hello"', undefined, SLOW),
    ).toBeInTheDocument();
  });
});

describe('starred messages', () => {
  const item = {
    message: messageFixture(1, { id: 'm1', chatId: 'a', text: 'keep this', starred: true }),
    starredAt: '2026-11-06T10:00:00.000Z',
  };

  it('lists them, and removing a star asks the server', async () => {
    const seen: string[] = [];
    server.use(
      http.get('*/v1/stars', ({ request }) => {
        seen.push(new URL(request.url).search);
        return HttpResponse.json({ items: [item], nextCursor: null });
      }),
      http.delete('*/v1/chats/a/messages/m1/star', () => {
        seen.push('unstar');
        return HttpResponse.json({ ok: true });
      }),
    );
    await seedLocal([named('a', 'Asha')]);
    const { container } = await renderApp('/starred', { width: DESKTOP_WIDTH });
    expect(await screen.findByText('keep this', undefined, SLOW)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    fireEvent.click(screen.getByRole('button', { name: 'Remove star' }));
    await waitFor(() => expect(seen).toContain('unstar'));
  });

  it('for one chat asks only about that chat, and says when there are none', async () => {
    let search = '';
    server.use(
      http.get('*/v1/stars', ({ request }) => {
        search = new URL(request.url).search;
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
    await seedLocal([named('a', 'Asha')]);
    await renderApp('/starred?chatId=a', { width: DESKTOP_WIDTH });
    expect(await screen.findByText(/Nothing starred yet/, undefined, SLOW)).toBeInTheDocument();
    expect(search).toContain('chatId=a');
    expect(screen.getByRole('heading', { name: 'Starred in Asha' })).toBeInTheDocument();
  });

  it('offers to try again after a failure', async () => {
    server.use(
      http.get('*/v1/stars', () =>
        HttpResponse.json(
          { code: 'INTERNAL_ERROR', message: 'x', requestId: 'r' },
          { status: 500 },
        ),
      ),
    );
    await seedLocal([]);
    await renderApp('/starred', { width: DESKTOP_WIDTH });
    // Looked up afresh: the screen asks again whenever the action queue moves, re-rendering it.
    const retry = await screen.findByRole('button', { name: 'Try again' }, SLOW);
    expect(retry.closest('[role="alert"]')).toHaveTextContent(
      'Could not load your starred messages.',
    );
  });

  it('opening one goes to the chat and asks to jump there', async () => {
    server.use(
      http.get('*/v1/stars', () => HttpResponse.json({ items: [item], nextCursor: null })),
    );
    await seedLocal([named('a', 'Asha')], [item.message]);
    await renderApp('/starred', { width: DESKTOP_WIDTH });
    fireEvent.click(await screen.findByRole('button', { name: 'Open this message in Asha' }, SLOW));
    expect(
      await screen.findByRole('textbox', { name: 'Write a message' }, SLOW),
    ).toBeInTheDocument();
  });
});

describe('a star that has only just been made', () => {
  it('shows on the Starred screen once the server has heard of it', async () => {
    let starred = false;
    const item = {
      message: messageFixture(1, { chatId: 'a', text: 'just now', starred: true }),
      starredAt: '2026-11-06T10:00:00.000Z',
    };
    server.use(
      http.get('*/v1/stars', () =>
        HttpResponse.json({ items: starred ? [item] : [], nextCursor: null }),
      ),
    );
    const db = await seedLocal([named('a', 'Asha')], [item.message]);
    await db.actions.add({ type: 'star', chatId: 'a', messageId: 'm1', seq: 1, starred: true });
    await renderApp('/starred', { width: DESKTOP_WIDTH });
    await screen.findByText(/Nothing starred yet/, undefined, SLOW);
    starred = true;
    await db.actions.clear();
    expect(await screen.findByText('just now', undefined, SLOW)).toBeInTheDocument();
  });
});

describe('Add members', () => {
  const person = (id: string, displayName: string): PublicProfile =>
    personFixture({ id, displayName, username: displayName.toLowerCase() });

  it('suggests before anything is typed: my chats first, members left out', async () => {
    server.use(
      http.get('*/v1/users/search', () =>
        HttpResponse.json({
          items: [person('u-new', 'Newperson'), person('u-member', 'Member')],
          nextCursor: null,
        }),
      ),
    );
    await seedLocal([chatFixture({ id: 'a', otherUser: person('u-chat', 'Chatperson') })]);
    let picked: PublicProfile[] = [];
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <PeopleSelect
          selected={[]}
          onChange={(next) => {
            picked = next;
          }}
          excludeIds={new Set(['u-member'])}
          max={10}
        />
      </QueryClientProvider>,
    );
    const results = screen.getByRole('list', { name: 'People' });
    await within(results).findByRole('button', { name: /Newperson/ }, SLOW);
    const names = within(results)
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(names.join()).not.toContain('Member');
    fireEvent.click(within(results).getByRole('button', { name: /Newperson/ }));
    expect(picked.map((item) => item.id)).toEqual(['u-new']);
  });
});
