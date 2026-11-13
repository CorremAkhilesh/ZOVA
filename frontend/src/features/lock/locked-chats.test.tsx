import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatListView } from '@/features/commands/chat-list-view';
import { useMessageUi } from '@/features/messages/store';
import { searchLocalChats } from '@/features/search/local-search';
import { useGlobalSearch } from '@/features/search/store';
import { toChatRow } from '@/features/sync/apply';
import { axe } from '@/test/axe';
import { chatFixture, messageFixture, personFixture } from '@/test/chat-fixtures';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { CHAT_UNLOCK_MS, CHATS_UNTIL_KEY, useLockStore } from './store';
import { serveLock } from './test-server';
import { resetLockState, SLOW, typePin } from './test-utils';

vi.setConfig({ testTimeout: 40_000 });

const secret = () =>
  chatFixture({
    id: 'c-secret',
    seq: 1,
    unreadCount: 1,
    locked: true,
    lastMessage: {
      id: 'm1',
      seq: 1,
      senderId: 'u-asha',
      type: 'text',
      preview: 'top secret plan',
      createdAt: '2026-11-04T10:00:00.000Z',
    },
    lastActivityAt: '2026-11-04T10:00:00.000Z',
  });
const open = () =>
  chatFixture({
    id: 'c-open',
    otherUser: personFixture({ id: 'u-rahul', displayName: 'Rahul Menon', username: 'rahul' }),
  });

beforeEach(() => {
  resetLockState();
  useMessageUi.setState({ chatMenu: null, menu: null, jump: null });
  useChatListView.setState({ archived: false });
  useGlobalSearch.setState({ open: false, initial: '' });
});
afterEach(() => vi.useRealTimers());

async function openList() {
  await seedLocal(
    [secret(), open()],
    [messageFixture(1, { chatId: 'c-secret', text: 'top secret plan' })],
  );
  const result = await renderApp('/chats', { width: DESKTOP_WIDTH });
  await screen.findByRole('link', { name: /Rahul Menon/ }, SLOW);
  return result;
}

const entry = () => screen.findByRole('button', { name: /Locked chats/ }, SLOW);
const rowNames = () =>
  within(screen.getByTestId('chat-rows'))
    .getAllByRole('link')
    .map((link) => link.textContent ?? '');

async function unlockFromEntry() {
  await userEvent.setup().click(await entry());
  await typePin('Enter your PIN', '1234', await screen.findByRole('dialog', {}, SLOW));
  return screen.findByTestId('locked-chat-rows', {}, SLOW);
}

describe('the "Locked chats" entry', () => {
  it('shows a count, but no names or previews, with no axe violations', async () => {
    serveLock('1234');
    const { container } = await openList();
    expect(await entry()).toHaveTextContent('Locked chats1');
    expect(rowNames().some((name) => name.includes('Asha'))).toBe(false);
    expect(document.body).not.toHaveTextContent('top secret');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('opens after the PIN, never shows the text, and locks again after 5 minutes', async () => {
    serveLock('1234');
    await openList();
    // Only timers and the clock: the local database keeps its own (real) scheduling.
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    const rows = await unlockFromEntry();
    expect(within(rows).getByRole('link', { name: /Asha Verma/ })).toHaveTextContent('Locked');
    expect(within(rows).getByLabelText('1 unread message')).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('top secret');
    expect(Number(sessionStorage.getItem(CHATS_UNTIL_KEY))).toBeGreaterThan(Date.now());
    expect(localStorage.getItem(CHATS_UNTIL_KEY)).toBeNull();
    act(() => vi.advanceTimersByTime(CHAT_UNLOCK_MS + 1000));
    await waitFor(() => expect(screen.queryByTestId('locked-chat-rows')).toBeNull());
    expect(useLockStore.getState().chatsUntil).toBeNull();
    expect(sessionStorage.getItem(CHATS_UNTIL_KEY)).toBeNull();
  });

  it('a wrong PIN says how many tries are left', async () => {
    serveLock('1234');
    await openList();
    await userEvent.setup().click(await entry());
    const dialog = await screen.findByRole('dialog', {}, SLOW);
    await typePin('Enter your PIN', '9999', dialog);
    expect(await within(dialog).findByRole('alert', {}, SLOW)).toHaveTextContent(
      'Wrong PIN. 4 tries left.',
    );
    expect(screen.queryByTestId('locked-chat-rows')).toBeNull();
  });
});

describe('Lock chat / Unlock chat', () => {
  async function menuFor(name: RegExp) {
    fireEvent.contextMenu(await screen.findByRole('link', { name }, SLOW));
    return screen.findByRole('menu', {}, SLOW);
  }

  it('locks a chat from its menu: it leaves the list', async () => {
    const api = serveLock('1234');
    await openList();
    const menu = await menuFor(/Rahul Menon/);
    fireEvent.click(await within(menu).findByRole('menuitem', { name: 'Lock chat' }));
    await waitFor(() =>
      expect(api.requests).toEqual([
        { method: 'PUT', path: '/v1/chats/c-open/lock', body: { locked: true } },
      ]),
    );
    await waitFor(() => expect(screen.queryByRole('link', { name: /Rahul Menon/ })).toBeNull());
    expect(await entry()).toHaveTextContent('Locked chats2');
  });

  it('without a PIN, asks for one first and then locks the chat', async () => {
    const api = serveLock(null);
    await openList();
    const menu = await menuFor(/Rahul Menon/);
    fireEvent.click(await within(menu).findByRole('menuitem', { name: 'Lock chat' }));
    const dialog = await screen.findByRole('dialog', { name: 'Set PIN' }, SLOW);
    await typePin(/Enter a new PIN/, '2468', dialog);
    await typePin('Enter the new PIN again', '2468', dialog);
    await waitFor(() =>
      expect(api.requests.at(-1)).toEqual({
        method: 'PUT',
        path: '/v1/chats/c-open/lock',
        body: { locked: true },
      }),
    );
    expect(api.requests[0]).toEqual({
      method: 'PUT',
      path: '/v1/me/lock/pin',
      body: { pin: '2468' },
    });
    await waitFor(() => expect(screen.queryByRole('link', { name: /Rahul Menon/ })).toBeNull());
  });

  it('unlocks a chat from the locked list: it comes back to the list', async () => {
    const api = serveLock('1234');
    await openList();
    await unlockFromEntry();
    const menu = await menuFor(/Asha Verma/);
    fireEvent.click(await within(menu).findByRole('menuitem', { name: 'Unlock chat' }));
    await waitFor(() =>
      expect(api.requests.at(-1)).toEqual({
        method: 'PUT',
        path: '/v1/chats/c-secret/lock',
        body: { locked: false },
      }),
    );
    await waitFor(() => expect(rowNames().some((name) => name.includes('Asha'))).toBe(true));
  });
});

describe('a link straight to a locked chat', () => {
  it('shows the PIN screen instead, then the chat', async () => {
    serveLock('1234');
    await seedLocal(
      [secret()],
      [messageFixture(1, { chatId: 'c-secret', text: 'top secret plan' })],
    );
    const { container } = await renderApp('/chats/c-secret', { width: DESKTOP_WIDTH });
    expect(
      await screen.findByRole('heading', { name: 'This chat is locked' }, SLOW),
    ).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('top secret');
    await screen.findByRole('group', { name: 'Enter your PIN' }, SLOW);
    expect(await axe(container)).toHaveNoViolations();
    await typePin('Enter your PIN', '1234');
    expect(await screen.findByText('top secret plan', {}, SLOW)).toBeInTheDocument();
  });
});

describe('search and the palette', () => {
  it('leave locked chats out of chats and messages', async () => {
    serveLock('1234');
    await openList();
    act(() => useGlobalSearch.getState().show(''));
    const box = await screen.findByRole('combobox', {}, SLOW);
    box.focus();
    const user = userEvent.setup();
    await user.keyboard('asha');
    const results = screen.getByRole('listbox', { name: 'Results' });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(within(results).queryByRole('option', { name: /Asha Verma/ })).toBeNull();
    await user.clear(box);
    await user.keyboard('secret');
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(results).not.toHaveTextContent('top secret');
  });

  it('searchLocalChats never returns a locked chat', () => {
    const rows = [toChatRow(secret()), toChatRow(open())];
    expect(searchLocalChats(rows, 'a', 'Saved').map((row) => row.id)).toEqual(['c-open']);
  });
});
