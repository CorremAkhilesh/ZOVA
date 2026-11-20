import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it } from 'vitest';
import { axe } from '@/test/axe';
import { HttpResponse, http, server, sessionFixture, storageFixture } from '@/test/msw';
import { renderApp } from '@/test/render-app';
import { storageChanged } from './api';

const MB = 1024 ** 2;
const GB = 1024 ** 3;

beforeEach(() => {
  toast.dismiss();
  try {
    localStorage.clear();
  } catch {
    // Nothing to clear.
  }
});

const serve = (usage: ReturnType<typeof storageFixture>) =>
  server.use(http.get('*/v1/me/storage', () => HttpResponse.json(usage)));

describe('Settings → Storage', () => {
  it('shows how much of my limit is used, by kind', async () => {
    serve(
      storageFixture({
        usedBytes: 1.5 * GB,
        pendingBytes: 200 * MB,
        byKind: { image: GB, video: 400 * MB, audio: 0, voice: 100 * MB, document: 24 * MB },
      }),
    );
    const { container } = await renderApp('/settings/storage');
    expect(await screen.findByText('1.7 GB of 3 GB used')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Storage used' })).toHaveAttribute(
      'aria-valuenow',
      '57',
    );
    expect(screen.getByText(/200 MB uploading/)).toBeInTheDocument();
    const photos = screen.getByText('Photos').closest('div');
    expect(photos).toHaveTextContent('1 GB');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('says so when nothing has been sent yet', async () => {
    const { container } = await renderApp('/settings/storage');
    expect(await screen.findByText('You haven’t sent any files yet.')).toBeInTheDocument();
    expect(screen.getByText('0 B of 3 GB used')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('warns at 90%, and says what to do when full', async () => {
    serve(storageFixture({ usedBytes: Math.round(2.8 * GB) }));
    const { unmount } = await renderApp('/settings/storage');
    expect(await screen.findByRole('alert')).toHaveTextContent('nearly full');
    unmount();
    serve(storageFixture({ usedBytes: 3 * GB }));
    const { container } = await renderApp('/settings/storage');
    expect(await screen.findByRole('alert')).toHaveTextContent('Your storage is full');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows an error with a way to try again', async () => {
    let fail = true;
    server.use(
      http.get('*/v1/me/storage', () =>
        fail
          ? HttpResponse.json(
              { code: 'INTERNAL_ERROR', message: 'x', requestId: 'r' },
              { status: 500 },
            )
          : HttpResponse.json(storageFixture()),
      ),
    );
    const { container } = await renderApp('/settings/storage');
    expect(
      await screen.findByText(/Couldn’t load your storage/, undefined, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    fail = false;
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('0 B of 3 GB used')).toBeInTheDocument();
  }, 20_000);

  it('is in the Settings menu', async () => {
    await renderApp('/settings');
    expect(await screen.findByRole('link', { name: /Storage/ })).toHaveAttribute(
      'href',
      '/settings/storage',
    );
  });
});

describe('the warning near the limit', () => {
  it('stays quiet below 90%, and an upload that crosses it brings the warning', async () => {
    let usage = storageFixture({ usedBytes: GB });
    let asked = 0;
    server.use(
      http.get('*/v1/me/storage', () => {
        asked += 1;
        return HttpResponse.json(usage);
      }),
    );
    await renderApp('/chats');
    await waitFor(() => expect(asked).toBeGreaterThan(0));
    expect(screen.queryByText('Your storage is nearly full')).not.toBeInTheDocument();

    usage = storageFixture({ usedBytes: Math.round(2.8 * GB) });
    const before = asked;
    storageChanged();
    await waitFor(() => expect(asked).toBeGreaterThan(before));
    expect(
      await screen.findByText('Your storage is nearly full', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByText('2.8 GB of 3 GB used')).toBeInTheDocument();
    // A plain click: jsdom has no pointer capture, which the toast's swipe handling asks for.
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(await screen.findByRole('heading', { name: 'Storage', level: 1 })).toBeInTheDocument();
  });
});

describe('Admin → Users: storage limit', () => {
  it('raises one person’s limit in GB, or puts the default back', async () => {
    const user = userEvent.setup();
    const bodies: unknown[] = [];
    server.use(
      http.get('*/v1/auth/me', () => {
        const session = sessionFixture();
        return HttpResponse.json({ ...session, user: { ...session.user, role: 'admin' } });
      }),
      http.get('*/v1/admin/users', () =>
        HttpResponse.json({
          items: [
            {
              id: 'u-meera',
              email: 'meera@corremadvisory.com',
              displayName: 'Meera Nair',
              username: 'meera',
              role: 'user',
              status: 'active',
              lastLoginAt: null,
              createdAt: new Date().toISOString(),
              storageBytes: 2 * GB,
              quotaBytes: 3 * GB,
            },
          ],
          nextCursor: null,
        }),
      ),
      http.put('*/v1/admin/users/:id/storage-quota', async ({ request }) => {
        const body = (await request.json()) as { quotaMb: number | null };
        bodies.push(body);
        return HttpResponse.json({
          quotaBytes: (body.quotaMb ?? 3072) * MB,
          custom: body.quotaMb !== null,
        });
      }),
    );
    await renderApp('/settings/admin/users');
    await user.click(await screen.findByRole('button', { name: 'Change limit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Storage limit for Meera Nair' });
    expect(dialog).toHaveTextContent('Using 2 GB of 3 GB.');
    expect(await axe(dialog)).toHaveNoViolations();
    const save = within(dialog).getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await user.type(within(dialog).getByLabelText('New limit (GB)'), '5');
    await user.click(save);
    await waitFor(() => expect(bodies).toEqual([{ quotaMb: 5120 }]));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Change limit' }));
    const again = await screen.findByRole('dialog');
    await user.click(within(again).getByRole('button', { name: 'Use default' }));
    await waitFor(() => expect(bodies).toEqual([{ quotaMb: 5120 }, { quotaMb: null }]));
  });
});
