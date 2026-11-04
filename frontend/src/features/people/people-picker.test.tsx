import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PublicProfile } from '@zuvo/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { axe } from '@/test/axe';
import { HttpResponse, http, server } from '@/test/msw';
import { renderApp } from '@/test/render-app';
import { recentPeople } from './recent-people';

const person = (id: string, displayName: string, username: string): PublicProfile => ({
  id,
  displayName,
  username,
  about: 'Hey there!',
  avatar: null,
  deactivated: false,
});
const meera = person('u-meera', 'Meera Nair', 'meera');
const mohan = person('u-mohan', 'Mohan Das', 'mohan');

afterEach(() => localStorage.clear());

async function openPicker() {
  const user = userEvent.setup();
  await renderApp('/chats');
  await user.click(screen.getByRole('button', { name: 'New chat' }));
  const dialog = await screen.findByRole('dialog', { name: 'New chat' });
  return { user, dialog };
}

describe('People picker', () => {
  it('suggests people, searches as you type and opens a profile with the keyboard', async () => {
    const queries: string[] = [];
    server.use(
      http.get('*/v1/users/search', ({ request }) => {
        const q = new URL(request.url).searchParams.get('q') ?? '';
        queries.push(q);
        return HttpResponse.json({
          items: q
            ? [meera, mohan].filter((p) => (p.username ?? '').startsWith(q))
            : [meera, mohan],
          nextCursor: null,
        });
      }),
      http.get('*/v1/users/:id', () =>
        HttpResponse.json({ user: { ...mohan, about: 'Fresh about' } }),
      ),
    );
    const { user, dialog } = await openPicker();
    expect(await within(dialog).findByText('Suggested')).toBeInTheDocument();
    expect(await axe(document.body)).toHaveNoViolations();

    const box = within(dialog).getByRole('combobox', { name: /Search name/ });
    await user.type(box, 'm');
    await waitFor(() => expect(queries).toContain('m'));
    await user.keyboard('{ArrowDown}');
    expect(within(dialog).getByRole('option', { name: /Mohan Das/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.keyboard('{Enter}');

    expect(await within(dialog).findByRole('heading', { name: 'Mohan Das' })).toBeInTheDocument();
    expect(await within(dialog).findByText('Fresh about')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Message' })).toBeDisabled();
    expect(recentPeople.load().map((p) => p.id)).toEqual(['u-mohan']);

    await user.click(within(dialog).getByRole('button', { name: 'Back' }));
    await user.clear(within(dialog).getByRole('combobox'));
    expect(await within(dialog).findByText('Recent & suggested')).toBeInTheDocument();
  });

  it('shows "no one found" and errors', async () => {
    server.use(
      http.get('*/v1/users/search', () => HttpResponse.json({ items: [], nextCursor: null })),
    );
    const { user, dialog } = await openPicker();
    expect(await within(dialog).findByText('No colleagues yet.')).toBeInTheDocument();
    await user.type(within(dialog).getByRole('combobox'), 'zzz');
    expect(await within(dialog).findByText('No one found.')).toBeInTheDocument();

    server.use(http.get('*/v1/users/search', () => HttpResponse.json({}, { status: 500 })));
    await user.type(within(dialog).getByRole('combobox'), 'q');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Search failed');
  });

  it('shows deactivated people without a message button', async () => {
    const gone: PublicProfile = {
      ...meera,
      displayName: 'Deactivated account',
      username: null,
      about: null,
      deactivated: true,
    };
    server.use(
      http.get('*/v1/users/search', () => HttpResponse.json({ items: [gone], nextCursor: null })),
      http.get('*/v1/users/:id', () => HttpResponse.json({ user: gone })),
    );
    const { user, dialog } = await openPicker();
    await user.click(await within(dialog).findByRole('option', { name: /Deactivated account/ }));
    expect(
      await within(dialog).findByText('This account has been deactivated.'),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Message' })).not.toBeInTheDocument();
  });
});
