import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNewChat } from '@/features/chats/new-chat-store';
import { useChatListView } from '@/features/commands/chat-list-view';
import { RECENT_COMMANDS_KEY } from '@/features/commands/recent';
import { useShortcutsHelp } from '@/features/commands/shortcuts-store';
import { useNewGroup } from '@/features/groups/rules';
import { useSyncStore } from '@/features/sync/store';
import { useThemeStore } from '@/features/theme/theme-store';
import { i18n } from '@/lib/i18n';
import { axe } from '@/test/axe';
import { chatFixture, savedChatFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { useGlobalSearch } from './store';

const SLOW = { timeout: 15_000 };
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => {
  useGlobalSearch.setState({ open: false, initial: '' });
  useShortcutsHelp.setState({ open: false });
  useChatListView.setState({ archived: false });
  useNewGroup.setState({ isOpen: false });
  server.use(
    http.get('*/v1/search/messages', () => HttpResponse.json({ items: [], nextCursor: null })),
    http.get('*/v1/users/search', () => HttpResponse.json({ items: [] })),
  );
});
afterEach(() => useThemeStore.setState({ mode: 'system' }));

async function openPalette(initial = '') {
  act(() => useGlobalSearch.getState().show(initial));
  // Any language: the field's name is translated.
  const box = await screen.findByRole('combobox', {}, SLOW);
  box.focus();
  return box;
}

const commandsGroup = () => screen.findByRole('group', { name: /^(Commands|कमांड)$/ }, SLOW);

/** Opens the palette in command mode with `query`, and runs the best match. */
async function run(query: string, expected: RegExp) {
  await openPalette(`>${query}`);
  const group = await commandsGroup();
  expect(within(group).getAllByRole('option')[0]).toHaveAccessibleName(expected);
  await userEvent.setup().keyboard('{Enter}');
  await waitFor(() => expect(useGlobalSearch.getState().open).toBe(false));
}

describe('command palette', () => {
  it('">" lists only commands, matched fuzzily, with no axe violations', async () => {
    await seedLocal([chatFixture({ id: 'c1' })]);
    const { container } = await renderApp('/chats', { width: DESKTOP_WIDTH });
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    const box = await screen.findByRole('combobox', { name: /Search chats/ }, SLOW);
    box.focus();
    await userEvent.setup().keyboard('>sett');
    const group = await commandsGroup();
    expect(within(group).getAllByRole('option')[0]).toHaveAccessibleName(/Go to Settings/);
    expect(screen.queryByRole('group', { name: 'Chats' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Photos' })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('lists all commands when nothing is typed, recent ones first', async () => {
    localStorage.setItem(RECENT_COMMANDS_KEY, JSON.stringify(['lock-app', 'go-starred']));
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    const box = await openPalette();
    const options = within(await commandsGroup()).getAllByRole('option');
    expect(options.length).toBeGreaterThan(10);
    expect(options[0]).toHaveAccessibleName(/Lock app/);
    expect(options[1]).toHaveAccessibleName(/Go to Starred/);
    expect(screen.getByText(/start with > to run a command/)).toBeInTheDocument();
    // The keyboard moves through them like through results.
    expect(box).toHaveAttribute('aria-activedescendant', 'search-command-lock-app');
    await userEvent.setup().keyboard('{ArrowDown}');
    expect(box).toHaveAttribute('aria-activedescendant', 'search-command-go-starred');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
  });

  it('"dark" finds Toggle theme above the results; Enter switches the theme and remembers it', async () => {
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
    await openPalette();
    await userEvent.setup().keyboard('dark');
    const group = await commandsGroup();
    expect(within(group).getAllByRole('option')).toHaveLength(1);
    expect(within(group).getByRole('option')).toHaveAccessibleName(/Toggle theme/);
    await userEvent.setup().keyboard('{Enter}');
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
    expect(useGlobalSearch.getState().open).toBe(false);
    expect(JSON.parse(localStorage.getItem(RECENT_COMMANDS_KEY) ?? '[]')).toEqual(['toggle-theme']);

    await openPalette();
    expect(within(await commandsGroup()).getAllByRole('option')[0]).toHaveAccessibleName(
      /Toggle theme/,
    );
    await userEvent.setup().keyboard('{Enter}');
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'));
  });

  it('shows "no matching commands" in command mode when nothing matches', async () => {
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    await openPalette('>qqqq');
    expect(await screen.findByText('No matching commands.', {}, SLOW)).toBeInTheDocument();
  });

  it('navigates: Starred, Archived, Settings and Devices', async () => {
    const { router } = await renderApp('/chats', { width: DESKTOP_WIDTH });
    const path = () => router.state.location.pathname;
    await run('starred', /Go to Starred/);
    await waitFor(() => expect(path()).toBe('/starred'));
    await run('archived', /Go to Archived/);
    await waitFor(() => expect(path()).toBe('/chats'));
    expect(useChatListView.getState().archived).toBe(true);
    await run('devices', /Go to Devices/);
    await waitFor(() => expect(path()).toBe('/settings/devices'));
    await run('go to settings', /Go to Settings/);
    await waitFor(() => expect(path()).toBe('/settings'));
  });

  it('opens New chat, New group and Saved Messages', async () => {
    await seedLocal([savedChatFixture()]);
    const { router } = await renderApp('/chats', { width: DESKTOP_WIDTH });
    await run('new chat', /New chat/);
    expect(useNewChat.getState().isOpen).toBe(true);
    act(() => useNewChat.setState({ isOpen: false }));
    await run('new group', /New group/);
    expect(useNewGroup.getState().isOpen).toBe(true);
    act(() => useNewGroup.setState({ isOpen: false }));
    await run('saved', /Open Saved Messages/);
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats/c-saved'));
  });

  it('switches the language, and English keywords still work in Hindi', async () => {
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    await run('language', /Switch language/);
    await waitFor(() => expect(i18n.language).toBe('hi'));
    await run('language', /भाषा बदलें/);
    await waitFor(() => expect(i18n.language).toBe('en'));
  });

  it('Lock app without a PIN opens Settings → Privacy to set one', async () => {
    const { router } = await renderApp('/chats', { width: DESKTOP_WIDTH });
    await run('lock', /Lock app/);
    expect(
      await screen.findByText('Set a PIN first to lock the app.', {}, SLOW),
    ).toBeInTheDocument();
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/privacy'));
  });

  it('Mark all as read reads every unread chat and clears "marked unread"', async () => {
    await seedLocal([
      chatFixture({ id: 'c1', seq: 4, unreadCount: 2 }),
      chatFixture({ id: 'c2', seq: 7, unreadCount: 0, markedUnread: true }),
      chatFixture({ id: 'c3', seq: 2, unreadCount: 0 }),
    ]);
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    await waitFor(() => expect(useSyncStore.getState().client).not.toBeNull());
    const client = useSyncStore.getState().client;
    if (!client) throw new Error('no sync client');
    const markRead = vi.spyOn(client, 'markRead').mockResolvedValue();
    const actFn = vi.spyOn(client, 'act').mockResolvedValue();
    await run('mark all', /Mark all as read/);
    expect(await screen.findByText('Marked 2 chats as read', {}, SLOW)).toBeInTheDocument();
    expect(markRead).toHaveBeenCalledTimes(1);
    expect(markRead).toHaveBeenCalledWith('c1', 4);
    expect(actFn).toHaveBeenCalledWith({ type: 'prefs', chatId: 'c2', prefs: { unread: false } });
  });
});

describe('keyboard shortcuts dialog', () => {
  it('Ctrl+/ opens it with every group; Esc closes it; no axe violations', async () => {
    const { container } = await renderApp('/chats', { width: DESKTOP_WIDTH });
    fireEvent.keyDown(window, { key: '/', code: 'Slash', ctrlKey: true });
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' }, SLOW);
    for (const name of ['General', 'Chats', 'Composer', 'Search']) {
      expect(within(dialog).getByRole('heading', { name })).toBeInTheDocument();
    }
    expect(within(dialog).getAllByText('Ctrl+K').length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText('Shift+Enter')).toHaveLength(2);
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.setup().keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('opens from the palette', async () => {
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    await run('shortcuts', /Keyboard shortcuts/);
    expect(
      await screen.findByRole('dialog', { name: 'Keyboard shortcuts' }, SLOW),
    ).toBeInTheDocument();
  });
});
