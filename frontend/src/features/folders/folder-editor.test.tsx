import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NO_FOLDER_RULES } from '@zuvo/protocol';
import { delay } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from '@/test/axe';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { useFolderEditor } from './store';
import { folderChats, folderFixture, serveFolders } from './test-server';

const SLOW = { timeout: 15_000 };
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => useFolderEditor.setState({ request: null }));
afterEach(() => localStorage.clear());

async function newFolderDialog() {
  await seedLocal(folderChats());
  const result = await renderApp('/chats', { width: DESKTOP_WIDTH });
  await screen.findByRole('link', { name: /Asha Verma/ }, SLOW);
  await userEvent.setup().click(screen.getByRole('button', { name: 'New folder' }));
  const dialog = await screen.findByRole('dialog', { name: 'New folder' }, SLOW);
  return { ...result, dialog };
}

async function typeName(dialog: HTMLElement, text: string) {
  const input = within(dialog).getByRole('textbox', { name: 'Name' });
  input.focus();
  await userEvent.setup().keyboard(text);
}

describe('folder editor', () => {
  it('creates a folder with an emoji, rules and picked chats', async () => {
    const api = serveFolders([]);
    const user = userEvent.setup();
    const { container, dialog } = await newFolderDialog();
    await typeName(dialog, ' Work ');
    await user.click(within(dialog).getByRole('radio', { name: '💼' }));
    await user.click(within(dialog).getByRole('checkbox', { name: /All groups/ }));
    await user.click(within(dialog).getByRole('checkbox', { name: /Leave out muted chats/ }));
    const search = within(dialog).getByRole('searchbox', { name: 'Search chats' });
    search.focus();
    await user.keyboard('rah');
    expect(within(dialog).queryByRole('checkbox', { name: /Asha Verma/ })).toBeNull();
    await user.click(within(dialog).getByRole('checkbox', { name: /Rahul Menon/ }));
    expect(within(dialog).getByText(/1 picked/)).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    await user.click(within(dialog).getByRole('button', { name: 'Create folder' }));
    await waitFor(() => expect(api.requests).toHaveLength(1));
    expect(api.requests[0]).toEqual({
      method: 'POST',
      path: '/v1/me/folders',
      body: {
        name: 'Work',
        emoji: '💼',
        chatIds: ['c-rahul'],
        rules: { ...NO_FOLDER_RULES, groups: true, excludeMuted: true },
      },
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByRole('tab', { name: '💼 Work' })).toBeInTheDocument();
  });

  it('asks for a name', async () => {
    const api = serveFolders([]);
    const { dialog } = await newFolderDialog();
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Create folder' }));
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Give the folder a name.');
    expect(api.requests).toEqual([]);
  });

  it('says so when I already have the most folders', async () => {
    serveFolders([]);
    server.use(
      http.post('*/v1/me/folders', () =>
        HttpResponse.json(
          { code: 'FOLDER_LIMIT_REACHED', message: 'Too many', requestId: 'r1' },
          { status: 409 },
        ),
      ),
    );
    const { dialog } = await newFolderDialog();
    await typeName(dialog, 'Eleventh');
    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Create folder' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'You can have up to 10 folders.',
    );
  });
});

describe('Settings → Chats → Folders', () => {
  const work = folderFixture({ id: 'f1', name: 'Work', emoji: '💼' });
  const friends = folderFixture({ id: 'f2', name: 'Friends', chatIds: ['c-asha'] });
  const section = () => screen.findByRole('heading', { name: 'Folders' }, SLOW);

  it('shows a loading state, then my folders, with no axe violations', async () => {
    serveFolders([work, friends]);
    server.use(
      http.get('*/v1/me/folders', async () => {
        await delay(300);
        return HttpResponse.json({ folders: [work, friends] });
      }),
    );
    const { container } = await renderApp('/settings/chats');
    expect(await screen.findByLabelText('Loading folders', undefined, SLOW)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Edit Friends' }, SLOW)).toBeInTheDocument();
    expect(screen.getByText('💼 Work')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Move Work up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Friends down' })).toBeDisabled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows an empty state', async () => {
    serveFolders([]);
    await renderApp('/settings/chats');
    await section();
    expect(await screen.findByText('No folders yet.', undefined, SLOW)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New folder' })).toBeEnabled();
  });

  it('shows an error when my folders cannot load', async () => {
    server.use(http.get('*/v1/me/folders', () => HttpResponse.json({}, { status: 500 })));
    await renderApp('/settings/chats');
    await section();
    const alert = await screen.findByText('Couldn’t load your folders.', undefined, SLOW);
    expect(alert.closest('[role="alert"]')).not.toBeNull();
  });

  it('turns off New folder at the limit', async () => {
    serveFolders(
      Array.from({ length: 10 }, (_, i) => folderFixture({ id: `f${i}`, name: `F${i}` })),
    );
    await renderApp('/settings/chats');
    expect(await screen.findByRole('button', { name: 'New folder' }, SLOW)).toBeDisabled();
    expect(screen.getByText('You can have up to 10 folders.')).toBeInTheDocument();
  });

  it('reorders with move up / move down', async () => {
    const api = serveFolders([work, friends]);
    const user = userEvent.setup();
    await renderApp('/settings/chats');
    await user.click(await screen.findByRole('button', { name: 'Move Friends up' }, SLOW));
    await waitFor(() =>
      expect(api.requests[0]).toEqual({
        method: 'PUT',
        path: '/v1/me/folders/order',
        body: { ids: ['f2', 'f1'] },
      }),
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Move Friends up' })).toBeDisabled(),
    );
  });

  it('deletes after asking', async () => {
    const api = serveFolders([work, friends]);
    const user = userEvent.setup();
    await renderApp('/settings/chats');
    await user.click(await screen.findByRole('button', { name: 'Delete Work' }, SLOW));
    const dialog = await screen.findByRole('dialog', { name: 'Delete “Work”?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete folder' }));
    await waitFor(() =>
      expect(api.requests[0]).toMatchObject({ method: 'DELETE', path: '/v1/me/folders/f1' }),
    );
    await waitFor(() => expect(screen.queryByText('💼 Work')).toBeNull());
  });

  it('edits a folder, and deletes one from the editor after confirming', async () => {
    const api = serveFolders([work, friends]);
    const user = userEvent.setup();
    await seedLocal(folderChats());
    await renderApp('/settings/chats');
    await user.click(await screen.findByRole('button', { name: 'Edit Work' }, SLOW));
    let dialog = await screen.findByRole('dialog', { name: 'Edit folder' }, SLOW);
    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    expect(name).toHaveValue('Work');
    await user.clear(name);
    await typeName(dialog, 'Office');
    await user.click(within(dialog).getByRole('radio', { name: 'None' }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(api.requests[0]).toEqual({
        method: 'PATCH',
        path: '/v1/me/folders/f1',
        body: { name: 'Office', emoji: null, chatIds: [], rules: NO_FOLDER_RULES },
      }),
    );
    expect(await screen.findByText('Office')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit Friends' }));
    dialog = await screen.findByRole('dialog', { name: 'Edit folder' }, SLOW);
    await user.click(within(dialog).getByRole('button', { name: 'Delete folder' }));
    const confirm = within(dialog).getByRole('group', { name: 'Delete “Friends”?' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete folder' }));
    await waitFor(() =>
      expect(api.requests[1]).toMatchObject({ method: 'DELETE', path: '/v1/me/folders/f2' }),
    );
  });
});
