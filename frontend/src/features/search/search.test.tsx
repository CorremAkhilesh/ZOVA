import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MessageSearchHit } from '@zuvo/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMessageUi } from '@/features/messages/store';
import { axe } from '@/test/axe';
import { chatFixture, messageFixture, personFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { useInChatSearch } from './in-chat-store';
import { matchesAll, searchLocalChats, snippetOf, wordsOf } from './local-search';
import { useGlobalSearch } from './store';

const SLOW = { timeout: 15_000 };
vi.setConfig({ testTimeout: 30_000 });
let asked: URLSearchParams[];

const hit = (seq: number, text: string): MessageSearchHit => ({
  message: messageFixture(seq, { text, createdAt: `2026-01-0${seq}T10:00:00.000Z` }),
  chat: { id: 'c1', type: 'direct', title: 'Asha Verma' },
  senderName: 'Asha Verma',
});

beforeEach(() => {
  asked = [];
  useGlobalSearch.setState({ open: false, initial: '' });
  useInChatSearch.setState({ chatId: null, term: '' });
  useMessageUi.setState({ jump: null });
  server.use(
    http.get('*/v1/search/messages', ({ request }) => {
      const params = new URL(request.url).searchParams;
      asked.push(params);
      return HttpResponse.json({ items: [hit(1, 'budget from last year')], nextCursor: null });
    }),
  );
});

async function seedChats() {
  await seedLocal(
    [
      chatFixture({ id: 'c1', seq: 3, otherUser: personFixture() }),
      chatFixture({
        id: 'c2',
        seq: 0,
        type: 'group',
        otherUser: null,
        group: { ...groupInfo(), name: 'Budget team' },
      }),
    ],
    [
      messageFixture(2, {
        text: 'the *budget* review is today',
        createdAt: '2026-11-04T10:00:00.000Z',
      }),
      messageFixture(3, { text: 'lunch?', createdAt: '2026-11-04T11:00:00.000Z' }),
    ],
  );
}

function groupInfo() {
  return {
    name: 'Team',
    description: '',
    photo: null,
    memberCount: 3,
    myRole: 'member' as const,
    active: true,
    settings: {
      sendMessages: 'all' as const,
      editInfo: 'all' as const,
      addMembers: 'all' as const,
    },
  };
}

describe('global search', () => {
  it('Ctrl+K opens it; chats and this device’s messages come at once, the server’s after', async () => {
    await seedChats();
    const { container, router } = await renderApp('/chats', { width: DESKTOP_WIDTH });
    await screen.findByRole('heading', { name: 'Chats' }, SLOW);
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const box = await screen.findByRole('combobox', { name: /Search chats/ }, SLOW);
    const user = userEvent.setup();
    box.focus();
    await user.keyboard('budget');
    const results = screen.getByRole('listbox', { name: 'Results' });
    const chats = await within(results).findByRole('group', { name: 'Chats' }, SLOW);
    expect(within(chats).getByRole('option', { name: /Budget team/ })).toBeInTheDocument();
    const messages = await within(results).findByRole('group', { name: 'Messages' }, SLOW);
    await waitFor(() => expect(messages).toHaveTextContent(/budget from last year/), SLOW);
    await waitFor(() => expect(messages).toHaveTextContent(/review is today/), SLOW);
    expect(messages.querySelectorAll('mark').length).toBeGreaterThan(0);
    expect(asked.at(-1)?.get('q')).toBe('budget');
    expect(await axe(container)).toHaveNoViolations();

    // The first option is the chat; down twice reaches the newest message, Enter opens it there.
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats/c1'));
    expect(useGlobalSearch.getState().open).toBe(false);
  });

  it('filters by kind, without chats or people', async () => {
    await seedChats();
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    act(() => useGlobalSearch.getState().show());
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Photos' }, SLOW));
    expect(screen.getByRole('button', { name: 'Photos' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(asked.at(-1)?.get('filter')).toBe('photos'));
    expect(screen.queryByRole('group', { name: 'Chats' })).not.toBeInTheDocument();
  });

  it('still shows this device’s results when the server cannot answer', async () => {
    server.use(http.get('*/v1/search/messages', () => HttpResponse.json({}, { status: 500 })));
    await seedChats();
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    act(() => useGlobalSearch.getState().show('review'));
    expect(await screen.findByRole('alert', {}, SLOW)).toHaveTextContent(
      'Couldn’t search older messages',
    );
    expect(await screen.findByRole('group', { name: 'Messages' }, SLOW)).toHaveTextContent(
      /review is today/,
    );
  });

  it('opens from the chat list’s search box with what was typed', async () => {
    await seedChats();
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    const user = userEvent.setup();
    (await screen.findByRole('searchbox', { name: 'Search chats' }, SLOW)).focus();
    await user.keyboard('lunch');
    await user.click(screen.getByRole('button', { name: 'Search messages for “lunch”' }));
    expect(await screen.findByRole('combobox', { name: /Search chats/ })).toHaveValue('lunch');
  });
});

describe('search in a chat', () => {
  it('marks matches, steps through them newest first, and closes with Esc', async () => {
    server.use(
      http.get('*/v1/search/messages', () =>
        HttpResponse.json({ items: [hit(1, 'apple pie')], nextCursor: null }),
      ),
      // The older match was never loaded here: jumping to it fetches that page first.
      http.get('*/v1/chats/c1/messages', () =>
        HttpResponse.json({ items: [hit(1, 'apple pie').message], hasMore: false }),
      ),
    );
    await seedLocal(
      [chatFixture({ id: 'c1', seq: 3 })],
      [
        messageFixture(2, { text: 'an apple a day', createdAt: '2026-11-04T10:00:00.000Z' }),
        messageFixture(3, { text: 'pears', createdAt: '2026-11-04T11:00:00.000Z' }),
      ],
    );
    await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Search in this chat' }, SLOW));
    const field = await screen.findByRole('searchbox', { name: 'Search in this chat' });
    field.focus();
    await user.keyboard('apple');
    expect(await screen.findByText('1 of 2', {}, SLOW)).toBeInTheDocument();
    const at = (seq: number) => document.querySelector(`[data-seq="${seq}"]`);
    await waitFor(() => expect(at(2)).toHaveClass(/bg-brand/), SLOW);
    expect(screen.getAllByText('apple', { selector: 'mark' }).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Older match' }));
    expect(screen.getByText('2 of 2')).toBeInTheDocument();
    await waitFor(() => expect(at(1)).toHaveClass(/bg-brand/), SLOW);
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('searchbox', { name: 'Search in this chat' })).toBeNull(),
    );
    expect(document.querySelector('mark')).toBeNull();
  });
});

describe('local search helpers', () => {
  it('matches every word, ignoring case and formatting, in any script', () => {
    expect(wordsOf('  Budget  REVIEW ')).toEqual(['budget', 'review']);
    expect(matchesAll('the *Budget* review', ['budget', 'review'])).toBe(true);
    expect(matchesAll('the budget', ['budget', 'review'])).toBe(false);
    expect(matchesAll('आज की बैठक रद्द', ['बैठक'])).toBe(true);
  });

  it('cuts a snippet around the first match, in plain text', () => {
    const long = `${'a '.repeat(60)}*needle* ${'b '.repeat(60)}`;
    const snippet = snippetOf(long, 'needle');
    expect(snippet).toContain('needle');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet).not.toContain('*');
  });

  it('finds chats by name or @username', () => {
    const chats = [
      { ...chatFixture({ id: 'c1' }), sortAt: 0 },
      { ...chatFixture({ id: 'c9', type: 'self', otherUser: null }), sortAt: 0 },
    ];
    expect(searchLocalChats(chats, 'asha', 'Saved Messages').map((chat) => chat.id)).toEqual([
      'c1',
    ]);
    expect(searchLocalChats(chats, 'saved', 'Saved Messages').map((chat) => chat.id)).toEqual([
      'c9',
    ]);
  });
});
