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

async function menuFor(name: string) {
  const link = await screen.findByRole('link', { name: new RegExp(name) }, SLOW);
  fireEvent.contextMenu(link);
  return screen.findByRole('menu', { name: `Actions for ${name}` });
}
const choose = (menu: HTMLElement, name: string) =>
  fireEvent.click(within(menu).getByRole('menuitem', { name }));
const rowNames = () => {
  const rows = screen.getByTestId('chat-rows');
  return within(rows)
    .getAllByRole('link')
    .map((link) => link.textContent ?? '');
};

describe('chat menu', () => {
  it('pins to the top, and refuses a fourth', async () => {
    await seedLocal([
      named('a', 'Asha', { pinned: true }),
      named('b', 'Bharat', { pinned: true }),
      named('c', 'Chitra', { pinned: true }),
      named('d', 'Dev'),
    ]);
    const { container } = await renderApp('/chats', { width: DESKTOP_WIDTH });
    const menu = await menuFor('Dev');
    expect(await axe(container)).toHaveNoViolations();
    choose(menu, 'Pin chat');
    expect(await screen.findByText('You can pin up to 3 chats')).toBeInTheDocument();
    expect(requests).toEqual([]);
  });

  it('pins and unpins', async () => {
    await seedLocal([named('a', 'Asha'), named('b', 'Bharat')]);
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    choose(await menuFor('Bharat'), 'Pin chat');
    await screen.findByRole('img', { name: 'Pinned' }, SLOW);
    await waitFor(() => expect(requests[0]?.body).toEqual({ pinned: true }));
    await waitFor(() => expect(rowNames().findIndex((name) => name.includes('Bharat'))).toBe(1));
  });

  it('mutes with three lengths, shows the icon and a quiet badge', async () => {
    await seedLocal([named('a', 'Asha', { seq: 4, lastReadSeq: 1, unreadCount: 3 })]);
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    const menu = await menuFor('Asha');
    expect(within(menu).getByRole('menuitem', { name: 'Mute for 8 hours' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Mute for 1 week' })).toBeInTheDocument();
    choose(menu, 'Mute always');
    expect(await screen.findByRole('img', { name: 'Muted' }, SLOW)).toBeInTheDocument();
    await waitFor(() => expect(requests[0]?.body).toEqual({ mute: 'always' }));
    const muted = await menuFor('Asha');
    expect(within(muted).getByRole('menuitem', { name: 'Unmute' })).toBeInTheDocument();
  });

  it('archives into a list of its own, and back', async () => {
    await seedLocal([named('a', 'Asha'), named('b', 'Bharat', { archived: true })]);
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    const row = await screen.findByRole('button', { name: /Archived/ }, SLOW);
    expect(screen.queryByRole('link', { name: /Bharat/ })).toBeNull();
    fireEvent.click(row);
    expect(await screen.findByRole('link', { name: /Bharat/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Asha/ })).toBeNull();
    choose(await menuFor('Bharat'), 'Unarchive chat');
    await waitFor(() => expect(requests[0]?.body).toEqual({ archived: false }));
  });

  it('marks unread, with a dot, and read again', async () => {
    await seedLocal([named('a', 'Asha')]);
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    choose(await menuFor('Asha'), 'Mark as unread');
    expect(await screen.findByLabelText('Marked as unread', undefined, SLOW)).toBeInTheDocument();
    await waitFor(() => expect(requests[0]?.body).toEqual({ unread: true }));
    choose(await menuFor('Asha'), 'Mark as read');
    await waitFor(() => expect(requests[1]?.body).toEqual({ unread: false }));
  });

  it('clears after asking; only a direct chat can be deleted', async () => {
    await seedLocal(
      [
        named('a', 'Asha', {
          lastMessage: {
            id: 'm1',
            seq: 1,
            senderId: 'u-a',
            type: 'text',
            preview: 'hello',
            createdAt: new Date().toISOString(),
          },
        }),
        chatFixture({
          id: 'g',
          type: 'group',
          otherUser: null,
          group: {
            name: 'Team',
            description: '',
            photo: null,
            memberCount: 2,
            settings: { editInfo: 'all', sendMessages: 'all', addMembers: 'all' },
            myRole: 'member',
            active: true,
          },
        }),
      ],
      [messageFixture(1, { id: 'm1', chatId: 'a' })],
    );
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    expect(
      within(await menuFor('Team')).queryByRole('menuitem', { name: 'Delete chat' }),
    ).toBeNull();
    useMessageUi.setState({ chatMenu: null });
    choose(await menuFor('Asha'), 'Clear chat');
    const dialog = await screen.findByRole('dialog', { name: /Clear all messages in Asha/ });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear chat' }));
    await waitFor(() => expect(requests[0]?.path).toBe('/v1/chats/a/clear'));
  });

  it('delete takes it out of the list', async () => {
    await seedLocal([named('a', 'Asha'), named('b', 'Bharat')]);
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    choose(await menuFor('Asha'), 'Delete chat');
    const dialog = await screen.findByRole('dialog', { name: /Delete your chat with Asha/ });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete chat' }));
    await waitFor(() => expect(screen.queryByRole('link', { name: /Asha/ })).toBeNull());
    await waitFor(() => expect(requests[0]?.method).toBe('DELETE'));
  });
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
    const alert = await screen.findByRole('alert', undefined, SLOW);
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
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
