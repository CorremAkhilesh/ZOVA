import { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NO_FOLDER_RULES } from '@zuvo/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChatListView } from '@/features/commands/chat-list-view';
import { useMessageUi } from '@/features/messages/store';
import { applyAccountChange } from '@/features/settings/chat-settings';
import { chatFixture } from '@/test/chat-fixtures';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { lastSocket } from '@/test/socket-mock';
import { FOLDERS_KEY } from './api';
import { SELECTED_FOLDER_KEY, useFolderEditor } from './store';
import { folderChats, folderFixture, serveFolders } from './test-server';

const SLOW = { timeout: 15_000 };
vi.setConfig({ testTimeout: 30_000 });

const work = folderFixture({
  id: 'f1',
  name: 'Work',
  emoji: '💼',
  chatIds: ['c-rahul'],
  rules: { ...NO_FOLDER_RULES, groups: true },
});
const friends = folderFixture({ id: 'f2', name: 'Friends', chatIds: ['c-asha'] });

beforeEach(() => {
  useMessageUi.setState({ chatMenu: null, menu: null, jump: null });
  useFolderEditor.setState({ request: null });
  useChatListView.setState({ archived: false });
});
afterEach(() => localStorage.clear());

const rowNames = () =>
  within(screen.getByTestId('chat-rows'))
    .getAllByRole('link')
    .map((link) => link.textContent ?? '');

async function openList() {
  await seedLocal(folderChats());
  const result = await renderApp('/chats', { width: DESKTOP_WIDTH });
  await screen.findByRole('link', { name: /Asha Verma/ }, SLOW);
  return result;
}

describe('folder chips', () => {
  it('shows my folders after the built-in chips, in my order, with unread counts', async () => {
    serveFolders([work, friends]);
    await openList();
    const tabs = await screen.findByRole('tablist', { name: 'Chat folders' });
    await waitFor(() => expect(within(tabs).getAllByRole('tab')).toHaveLength(6));
    expect(
      within(tabs)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['All1', 'Unread1', 'Personal1', 'Groups', '💼 Work', 'Friends1']);
    // Team is unread but muted, so it doesn't count.
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAccessibleDescription(
      '1 chat with unread messages',
    );
    expect(screen.getByRole('tab', { name: '💼 Work' })).not.toHaveAccessibleDescription();
  });

  it('filters by a folder and remembers it on this device', async () => {
    serveFolders([work, friends]);
    const user = userEvent.setup();
    await openList();
    await user.click(await screen.findByRole('tab', { name: '💼 Work' }));
    expect(rowNames().some((name) => name.includes('Rahul Menon'))).toBe(true);
    expect(rowNames().some((name) => name.includes('Team'))).toBe(true);
    expect(rowNames().some((name) => name.includes('Asha'))).toBe(false);
    expect(localStorage.getItem(SELECTED_FOLDER_KEY)).toBe('folder:f1');
  });

  it('falls back to All when the remembered folder was deleted', async () => {
    serveFolders([friends]);
    localStorage.setItem(SELECTED_FOLDER_KEY, 'folder:gone');
    await openList();
    await screen.findByRole('tab', { name: 'Friends' });
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true'),
    );
    expect(localStorage.getItem(SELECTED_FOLDER_KEY)).toBeNull();
  });

  it('opens the folder editor from "+"', async () => {
    serveFolders([]);
    const user = userEvent.setup();
    await openList();
    await user.click(screen.getByRole('button', { name: 'New folder' }));
    expect(await screen.findByRole('dialog', { name: 'New folder' }, SLOW)).toBeInTheDocument();
  });

  it('refetches my folders when another device changes them', async () => {
    const api = serveFolders([]);
    await openList();
    await waitFor(() => expect(lastSocket()).toBeDefined());
    api.folders = [friends];
    act(() => lastSocket().receive('folders:updated', {}));
    expect(await screen.findByRole('tab', { name: 'Friends' }, SLOW)).toBeInTheDocument();
  });
});

describe('the archived view', () => {
  it('opens from the store, as "Go to Archived" does, and goes back', async () => {
    serveFolders([]);
    await seedLocal([...folderChats(), chatFixture({ id: 'c-old', archived: true })]);
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    await screen.findByRole('link', { name: /Asha Verma/ }, SLOW);
    expect(rowNames()).toHaveLength(4);
    act(() => useChatListView.getState().showArchived());
    await waitFor(() => expect(rowNames()).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Back to chats' }));
    await waitFor(() => expect(rowNames()).toHaveLength(4));
    expect(useChatListView.getState().archived).toBe(false);
  });
});

describe('Add to folder', () => {
  async function addToFolderMenu() {
    fireEvent.contextMenu(await screen.findByRole('link', { name: /Asha Verma/ }, SLOW));
    const menu = await screen.findByRole('menu', { name: 'Actions for Asha Verma' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Add to folder' }));
    return screen.findByRole('menu', { name: 'Add to folder' });
  }

  it('ticks the folders that pick the chat, and toggles it in one', async () => {
    const api = serveFolders([work, friends]);
    await openList();
    await screen.findByRole('tab', { name: 'Friends' }, SLOW);
    const sub = await addToFolderMenu();
    expect(within(sub).getByRole('menuitemcheckbox', { name: 'Friends' })).toBeChecked();
    fireEvent.click(within(sub).getByRole('menuitemcheckbox', { name: '💼 Work' }));
    await waitFor(() =>
      expect(api.requests[0]).toEqual({
        method: 'PATCH',
        path: '/v1/me/folders/f1',
        body: { chatIds: ['c-rahul', 'c-asha'] },
      }),
    );
    fireEvent.click(
      within(await addToFolderMenu()).getByRole('menuitemcheckbox', { name: 'Friends' }),
    );
    await waitFor(() =>
      expect(api.requests[1]).toEqual({
        method: 'PATCH',
        path: '/v1/me/folders/f2',
        body: { chatIds: [] },
      }),
    );
  });

  it('starts a new folder with the chat picked', async () => {
    serveFolders([]);
    await openList();
    const sub = await addToFolderMenu();
    fireEvent.click(within(sub).getByRole('menuitem', { name: 'New folder…' }));
    const dialog = await screen.findByRole('dialog', { name: 'New folder' }, SLOW);
    expect(await within(dialog).findByRole('checkbox', { name: /Asha Verma/ })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: /Rahul Menon/ })).not.toBeChecked();
  });
});

describe('account changes', () => {
  it('refetches folders on folders:updated and after a reconnect', () => {
    const client = new QueryClient();
    client.setQueryData(FOLDERS_KEY, []);
    applyAccountChange(client, { kind: 'folders' });
    expect(client.getQueryState(FOLDERS_KEY)?.isInvalidated).toBe(true);
    client.setQueryData(FOLDERS_KEY, []);
    applyAccountChange(client, { kind: 'reconnected' });
    expect(client.getQueryState(FOLDERS_KEY)?.isInvalidated).toBe(true);
  });
});
