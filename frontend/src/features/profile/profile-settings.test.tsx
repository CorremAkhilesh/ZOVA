import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { axe } from '@/test/axe';
import { HttpResponse, http, privacyFixture, profileFixture, server } from '@/test/msw';
import { renderApp } from '@/test/render-app';
import { nextUsernameChange } from './components/UsernameEditor';

const DAY = 86_400_000;

describe('Settings → Profile', () => {
  it('shows a loading state, then the profile, with no axe violations', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('*/v1/me/profile', async () => {
        await gate;
        return HttpResponse.json({ profile: profileFixture({ about: 'On leave Friday' }) });
      }),
    );
    const { container } = await renderApp('/settings/profile');
    expect(screen.getByLabelText('Loading')).toHaveAttribute('aria-busy', 'true');
    release();
    expect(await screen.findByText('On leave Friday')).toBeInTheDocument();
    expect(screen.getByText('@kiran')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows an error with a retry', async () => {
    server.use(http.get('*/v1/me/profile', () => HttpResponse.json({}, { status: 500 })));
    await renderApp('/settings/profile');
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load your profile.');
    server.use(http.get('*/v1/me/profile', () => HttpResponse.json({ profile: profileFixture() })));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Kiran Rao')).toBeInTheDocument();
  });

  it('edits the name in place, optimistically, and rolls back on failure', async () => {
    const user = userEvent.setup();
    let fail = false;
    server.use(
      http.patch('*/v1/me/profile', async ({ request }) => {
        if (fail)
          return HttpResponse.json(
            { code: 'INTERNAL_ERROR', message: 'Boom', requestId: 'r' },
            { status: 500 },
          );
        const body = (await request.json()) as { displayName: string };
        return HttpResponse.json({ profile: profileFixture({ displayName: body.displayName }) });
      }),
    );
    await renderApp('/settings/profile');
    await user.click(await screen.findByRole('button', { name: 'Edit Your name' }));
    const input = screen.getByRole('textbox', { name: 'Your name' });
    await user.clear(input);
    await user.type(input, 'Kiran R{Enter}');
    expect(await screen.findByText('Kiran R')).toBeInTheDocument();

    fail = true;
    await user.click(screen.getByRole('button', { name: 'Edit Your name' }));
    await user.clear(screen.getByRole('textbox', { name: 'Your name' }));
    await user.type(screen.getByRole('textbox', { name: 'Your name' }), 'Nope{Enter}');
    await waitFor(() => expect(screen.queryByText('Nope')).not.toBeInTheDocument());
    expect(screen.getByText('Kiran R')).toBeInTheDocument();
  });

  it('validates the name and supports Escape to cancel', async () => {
    const user = userEvent.setup();
    await renderApp('/settings/profile');
    await user.click(await screen.findByRole('button', { name: 'Edit Your name' }));
    await user.clear(screen.getByRole('textbox', { name: 'Your name' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your name');
    await user.click(screen.getByRole('textbox', { name: 'Your name' }));
    await user.keyboard('{Escape}');
    expect(screen.getByText('Kiran Rao')).toBeInTheDocument();
  });

  it('changes the username and locks it for 30 days', async () => {
    const user = userEvent.setup();
    server.use(
      http.put('*/v1/me/username', () =>
        HttpResponse.json({
          profile: profileFixture({
            username: 'kiran.r',
            usernameChangedAt: new Date().toISOString(),
          }),
        }),
      ),
    );
    await renderApp('/settings/profile');
    await user.click(await screen.findByRole('button', { name: 'Edit Username' }));
    const field = screen.getByRole('textbox', { name: 'Username' });
    await user.clear(field);
    await user.type(field, 'kiran.r');
    expect(await screen.findByText('Available')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('@kiran.r')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Username' })).toBeDisabled();
    expect(screen.getByText(/You can change it again on/)).toBeInTheDocument();
  });

  it('removes the photo after confirmation', async () => {
    const user = userEvent.setup();
    const avatar = {
      small: '/v1/users/u-test/avatar?size=small&v=1',
      large: '/v1/users/u-test/avatar?size=large&v=1',
    };
    server.use(
      http.get('*/v1/me/profile', () => HttpResponse.json({ profile: profileFixture({ avatar }) })),
      http.delete('*/v1/me/avatar', () => HttpResponse.json({ profile: profileFixture() })),
    );
    await renderApp('/settings/profile');
    await user.click(await screen.findByRole('button', { name: 'Remove photo' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove profile photo?' });
    expect(await axe(document.body)).toHaveNoViolations();
    await user.click(within(dialog).getByRole('button', { name: 'Remove photo' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Remove photo' })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Add photo' })).toBeInTheDocument();
  });
});

describe('nextUsernameChange', () => {
  it('is null for a first username or after 30 days', () => {
    const now = Date.now();
    expect(nextUsernameChange(profileFixture({ username: null }), now)).toBeNull();
    expect(nextUsernameChange(profileFixture({ usernameChangedAt: null }), now)).toBeNull();
    const old = new Date(now - 31 * DAY).toISOString();
    expect(nextUsernameChange(profileFixture({ usernameChangedAt: old }), now)).toBeNull();
    const recent = new Date(now - DAY).toISOString();
    expect(nextUsernameChange(profileFixture({ usernameChangedAt: recent }), now)?.getTime()).toBe(
      now - DAY + 30 * DAY,
    );
  });
});

describe('Settings → Privacy', () => {
  it('saves each choice immediately and rolls back on failure (axe clean)', async () => {
    const user = userEvent.setup();
    const saved: unknown[] = [];
    server.use(
      http.put('*/v1/me/privacy', async ({ request }) => {
        const body = await request.json();
        saved.push(body);
        if (saved.length > 1) return HttpResponse.json({}, { status: 500 });
        return HttpResponse.json({ privacy: body });
      }),
    );
    const { container } = await renderApp('/settings/privacy');
    const photo = await screen.findByRole('radiogroup', { name: 'Profile photo' });
    expect(await axe(container)).toHaveNoViolations();
    await user.click(within(photo).getByRole('radio', { name: 'Nobody' }));
    expect(within(photo).getByRole('radio', { name: 'Nobody' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(saved[0]).toEqual({ ...privacyFixture, profilePhoto: 'nobody' });

    const receipts = screen.getByRole('radiogroup', { name: 'Read receipts' });
    await user.click(within(receipts).getByRole('radio', { name: 'Off' }));
    await waitFor(() =>
      expect(within(receipts).getByRole('radio', { name: 'On' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
  });

  it('shows an error when privacy settings cannot load', async () => {
    server.use(http.get('*/v1/me/privacy', () => HttpResponse.json({}, { status: 500 })));
    await renderApp('/settings/privacy');
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load privacy settings.');
  });
});
