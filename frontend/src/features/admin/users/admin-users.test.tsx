import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '@/test/axe';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, MOBILE_WIDTH, renderApp } from '@/test/render-app';
import { quotaMbOf } from './QuotaPicker';
import { adminSession, detail, ME, row, SLOW, serve } from './test-fixtures';

vi.setConfig({ testTimeout: 30_000 });

describe('Admin → Users list', () => {
  it('shows people with push, last active and storage; filters, sorts and searches', async () => {
    const user = userEvent.setup();
    const { queries } = serve();
    const { container } = await renderApp('/admin/users', { width: DESKTOP_WIDTH });
    expect(await screen.findByRole('link', { name: 'Meera Nair' }, SLOW)).toHaveAttribute(
      'href',
      '/admin/users/meera',
    );
    expect(screen.getByText('Notifications off · 1 device')).toBeInTheDocument();
    expect(screen.getAllByText('Active 2 hours ago').length).toBeGreaterThan(0);
    const meter = screen
      .getAllByRole('meter', { name: 'Storage' })
      .find((element) => element.getAttribute('aria-valuetext')?.includes('2.8 GB of 3 GB'));
    expect(meter).toHaveAttribute('aria-valuenow', '93');
    expect(await axe(container)).toHaveNoViolations();

    await user.selectOptions(screen.getByLabelText('Show'), 'Storage 80%+');
    await user.selectOptions(screen.getByLabelText('Sort by'), 'Storage used');
    await user.type(screen.getByRole('searchbox'), 'mee');
    await waitFor(() => {
      const last = queries.at(-1);
      expect(last?.get('filter')).toBe('storageHigh');
      expect(last?.get('sort')).toBe('storage');
      expect(last?.get('q')).toBe('mee');
    });
  });

  it('selects several (never yourself) and runs a bulk action with a reason', async () => {
    const user = userEvent.setup();
    const { posted } = serve();
    await renderApp('/admin/users', { width: DESKTOP_WIDTH });
    await screen.findByRole('link', { name: 'Meera Nair' }, SLOW);
    expect(screen.getByRole('checkbox', { name: 'Select Kiran Rao' })).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Select everyone shown' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sign out of all devices' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sign 2 people out everywhere?' });
    const confirm = within(dialog).getByRole('button', { name: 'Sign out of all devices' });
    expect(confirm).toBeDisabled();
    await user.type(within(dialog).getByLabelText('Reason'), 'Lost laptop');
    expect(await axe(dialog)).toHaveNoViolations();
    await user.click(confirm);
    await waitFor(() =>
      expect(posted).toEqual([
        {
          url: '/v1/admin/users/bulk',
          body: { userIds: ['meera', 'ravi'], action: 'signOut', reason: 'Lost laptop' },
        },
      ]),
    );
    expect(await screen.findByText(/1 done, 1 not changed/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('2 selected')).not.toBeInTheDocument());
  });

  it('sets a storage limit for a selection from the presets', async () => {
    const user = userEvent.setup();
    const { posted } = serve();
    await renderApp('/admin/users', { width: DESKTOP_WIDTH });
    await user.click(await screen.findByRole('checkbox', { name: 'Select Ravi Shah' }, SLOW));
    await user.click(screen.getByRole('checkbox', { name: 'Select Meera Nair' }));
    await user.click(screen.getByRole('button', { name: 'Change storage limit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Storage limit for 2 people' });
    await user.type(within(dialog).getByLabelText('Reason'), 'Design team');
    const confirm = within(dialog).getByRole('button', { name: 'Change storage limit' });
    expect(confirm).toBeDisabled();
    await user.click(within(dialog).getByRole('radio', { name: '10 GB' }));
    await user.click(confirm);
    await waitFor(() =>
      expect(posted.at(-1)?.body).toEqual({
        userIds: ['ravi', 'meera'],
        action: 'storageQuota',
        quotaMb: 10_240,
        reason: 'Design team',
      }),
    );
  });

  it('shows loading, then an error with a retry, and an empty list', async () => {
    let calls = 0;
    server.use(
      http.get('*/v1/auth/me', () => HttpResponse.json(adminSession())),
      http.get('*/v1/admin/users', () => {
        calls += 1;
        return calls === 1
          ? HttpResponse.json(
              { code: 'INTERNAL_ERROR', message: 'x', requestId: 'r' },
              { status: 500 },
            )
          : HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
    await renderApp('/admin/users', { width: MOBILE_WIDTH });
    const alert = await screen.findByRole('alert', {}, SLOW);
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No users found.', {}, SLOW)).toBeInTheDocument();
  });

  it('on a phone: no axe violations', async () => {
    serve();
    const { container } = await renderApp('/admin/users', { width: MOBILE_WIDTH });
    await screen.findByRole('link', { name: 'Meera Nair' }, SLOW);
    expect(await axe(container)).toHaveNoViolations();
  });
});

describe('Admin → Users → one person', () => {
  it('shows facts, storage by kind and devices; signs out with a reason', async () => {
    const user = userEvent.setup();
    const { posted } = serve();
    server.use(http.get('*/v1/admin/users/meera', () => HttpResponse.json(detail())));
    const { container } = await renderApp('/admin/users/meera', { width: DESKTOP_WIDTH });
    expect(
      await screen.findByRole('heading', { name: 'Meera Nair', level: 1 }, SLOW),
    ).toBeVisible();
    expect(screen.getByText('Chrome on Android')).toBeInTheDocument();
    expect(screen.getByText('The default limit for everyone.')).toBeInTheDocument();
    expect(screen.getByText('1 GB')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await user.click(screen.getByRole('button', { name: 'Sign out of all devices' }));
    const dialog = await screen.findByRole('dialog', { name: 'Sign Meera Nair out everywhere?' });
    await user.type(within(dialog).getByLabelText('Reason'), 'Phone stolen');
    await user.click(within(dialog).getByRole('button', { name: 'Sign out of all devices' }));
    await waitFor(() =>
      expect(posted).toEqual([
        { url: '/v1/admin/users/meera/sign-out', body: { reason: 'Phone stolen' } },
      ]),
    );
  });

  it('sets a custom limit, or the default, with a reason', async () => {
    const user = userEvent.setup();
    const { posted } = serve();
    server.use(http.get('*/v1/admin/users/meera', () => HttpResponse.json(detail())));
    await renderApp('/admin/users/meera', { width: DESKTOP_WIDTH });
    await user.click(await screen.findByRole('button', { name: 'Change storage limit' }, SLOW));
    const dialog = await screen.findByRole('dialog', { name: 'Storage limit for Meera Nair' });
    await user.click(within(dialog).getByRole('radio', { name: 'Custom' }));
    await user.type(within(dialog).getByLabelText('Size in GB'), '7.5');
    await user.type(within(dialog).getByLabelText('Reason'), 'Video work');
    await user.click(within(dialog).getByRole('button', { name: 'Change storage limit' }));
    await waitFor(() =>
      expect(posted.at(-1)).toEqual({
        url: '/v1/admin/users/meera/storage-quota',
        body: { quotaMb: 7680, reason: 'Video work' },
      }),
    );
  });

  it('for yourself: no sign-out, role or deactivation', async () => {
    serve();
    server.use(
      http.get(`*/v1/admin/users/${ME}`, () =>
        HttpResponse.json({
          ...detail({ role: 'admin' }),
          user: row(ME, 'Kiran Rao', { role: 'admin' }),
        }),
      ),
    );
    await renderApp(`/admin/users/${ME}`, { width: MOBILE_WIDTH });
    expect(await screen.findByText(/This is you/, {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
  });
});

describe('quotaMbOf', () => {
  it('turns a choice into MiB, null for the default, undefined until valid', () => {
    expect(quotaMbOf({ kind: 'preset', gb: 5 })).toBe(5120);
    expect(quotaMbOf({ kind: 'default' })).toBeNull();
    expect(quotaMbOf({ kind: 'custom', text: '1,5' })).toBe(1536);
    expect(quotaMbOf({ kind: 'custom', text: '' })).toBeUndefined();
    expect(quotaMbOf({ kind: 'custom', text: '2000' })).toBeUndefined();
    expect(quotaMbOf(null)).toBeUndefined();
  });
});
