import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from '@/test/axe';
import { HttpResponse, http, server } from '@/test/msw';
import { renderApp } from '@/test/render-app';
import { serveLock } from './test-server';
import { resetLockState, SLOW, stubBiometric, typePin } from './test-utils';

vi.setConfig({ testTimeout: 30_000 });
vi.mock('@simplewebauthn/browser', () => ({
  startRegistration: vi.fn(async () => ({ id: 'cred-1', type: 'public-key' })),
  startAuthentication: vi.fn(async () => ({ id: 'cred-1', type: 'public-key' })),
}));

beforeEach(resetLockState);

const section = () => screen.findByRole('heading', { name: 'Chat lock' }, SLOW);
const sectionBox = async () => (await section()).closest('section') as HTMLElement;

describe('Settings → Privacy → Chat lock', () => {
  it('loads, then offers to set a PIN, with no axe violations', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    serveLock(null);
    server.use(
      http.get('*/v1/me/lock', async () => {
        await gate;
        return HttpResponse.json({
          lock: {
            pinSet: false,
            appLock: { enabled: false, idleMinutes: 5 },
            lockedUntil: null,
            attemptsLeft: 5,
            biometricCount: 0,
          },
        });
      }),
    );
    const { container } = await renderApp('/settings/privacy');
    expect(await screen.findByLabelText('Loading chat lock', {}, SLOW)).toBeInTheDocument();
    release();
    expect(await screen.findByRole('button', { name: 'Set PIN' }, SLOW)).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /App lock/ })).toBeDisabled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows an error when the lock settings cannot load', async () => {
    server.use(http.get('*/v1/me/lock', () => HttpResponse.json({}, { status: 500 })));
    await renderApp('/settings/privacy');
    const box = await sectionBox();
    expect(await within(box).findByRole('alert', {}, SLOW)).toHaveTextContent(
      'Couldn’t load your chat lock settings.',
    );
  });

  it('sets a PIN: enter it, confirm it (a mismatch asks again)', async () => {
    const api = serveLock(null);
    const user = userEvent.setup();
    await renderApp('/settings/privacy');
    await user.click(await screen.findByRole('button', { name: 'Set PIN' }, SLOW));
    const dialog = await screen.findByRole('dialog', { name: 'Set PIN' });
    expect(await axe(dialog)).toHaveNoViolations();
    await typePin(/Enter a new PIN/, '1234', dialog);
    await typePin('Enter the new PIN again', '4321', dialog);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('The PINs don’t match.');
    await typePin(/Enter a new PIN/, '1234', dialog);
    await typePin('Enter the new PIN again', '1234', dialog);
    await waitFor(() =>
      expect(api.requests).toEqual([
        { method: 'PUT', path: '/v1/me/lock/pin', body: { pin: '1234' } },
      ]),
    );
    expect(await screen.findByText('PIN set', {}, SLOW)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Change PIN' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /App lock/ })).toBeEnabled();
  });

  it('changes the PIN with the current one, and asks again when that was wrong', async () => {
    const api = serveLock('1234');
    const user = userEvent.setup();
    await renderApp('/settings/privacy');
    await user.click(await screen.findByRole('button', { name: 'Change PIN' }, SLOW));
    const dialog = await screen.findByRole('dialog', { name: 'Change PIN' });
    await typePin('Enter your current PIN', '0000', dialog);
    await typePin(/Enter a new PIN/, '5678', dialog);
    await typePin('Enter the new PIN again', '5678', dialog);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Wrong PIN. 4 tries left.');
    await typePin('Enter your current PIN', '1234', dialog);
    await typePin(/Enter a new PIN/, '5678', dialog);
    await typePin('Enter the new PIN again', '5678', dialog);
    await waitFor(() => expect(api.pin).toBe('5678'));
    expect(api.requests.at(-1)).toEqual({
      method: 'PUT',
      path: '/v1/me/lock/pin',
      body: { pin: '5678', currentPin: '1234' },
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('removes the PIN after the current one', async () => {
    const api = serveLock('1234');
    const user = userEvent.setup();
    await renderApp('/settings/privacy');
    await user.click(await screen.findByRole('button', { name: 'Remove PIN' }, SLOW));
    await typePin('Enter your current PIN', '1234', await screen.findByRole('dialog'));
    await waitFor(() =>
      expect(api.requests).toEqual([
        { method: 'DELETE', path: '/v1/me/lock/pin', body: { pin: '1234' } },
      ]),
    );
    expect(await screen.findByRole('button', { name: 'Set PIN' }, SLOW)).toBeInTheDocument();
  });

  it('turns app lock on and picks the idle time', async () => {
    const api = serveLock('1234');
    const user = userEvent.setup();
    await renderApp('/settings/privacy');
    await user.click(await screen.findByRole('switch', { name: /App lock/ }, SLOW));
    const idle = await screen.findByRole('radiogroup', { name: 'Lock after' });
    expect(within(idle).getByRole('radio', { name: '5 minutes' })).toBeChecked();
    await user.click(within(idle).getByRole('radio', { name: '15 minutes' }));
    await waitFor(() =>
      expect(api.requests.map((request) => request.body)).toEqual([
        { appLock: { enabled: true, idleMinutes: 5 } },
        { appLock: { enabled: true, idleMinutes: 15 } },
      ]),
    );
    expect(within(idle).getByRole('radio', { name: '15 minutes' })).toBeChecked();
  });

  it('resets a forgotten PIN by email, then asks for a new one', async () => {
    const api = serveLock('1234');
    const user = userEvent.setup();
    await renderApp('/settings/privacy');
    await user.click(await screen.findByRole('button', { name: 'Forgot PIN?' }, SLOW));
    const dialog = await screen.findByRole('dialog', { name: 'Reset your PIN' });
    expect(dialog).toHaveTextContent('kiran@corremadvisory.com');
    await user.click(within(dialog).getByRole('button', { name: 'Email me a code' }));
    expect(
      await within(dialog).findByRole('button', { name: /Send a new code in 1:00|0:59/ }),
    ).toBeDisabled();
    const first = within(dialog).getByRole('textbox', { name: /Digit 1/ });
    first.focus();
    await user.keyboard('123456');
    await waitFor(() => expect(api.pin).toBeNull());
    expect(api.requests.map((request) => request.path)).toEqual([
      '/v1/me/lock/reset/request',
      '/v1/me/lock/reset/verify',
    ]);
    expect(api.requests[1]?.body).toEqual({ code: '123456' });
    const setup = await screen.findByRole('dialog', { name: 'Set PIN' }, SLOW);
    expect(setup).toHaveAccessibleDescription('Your PIN was reset. Choose a new one.');
  });
});

describe('Windows Hello / fingerprint in Settings', () => {
  it('explains when this device cannot use it', async () => {
    serveLock('1234');
    await renderApp('/settings/privacy');
    expect(
      await screen.findByText(/can’t unlock with Windows Hello/, {}, SLOW),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add this device' })).toBeNull();
  });

  it('adds this device, and removes them all', async () => {
    stubBiometric(true);
    const api = serveLock('1234');
    const posted: unknown[] = [];
    server.use(
      http.post('*/v1/me/lock/biometric/register/options', () =>
        HttpResponse.json({ options: { challenge: 'abc' } }),
      ),
      http.post('*/v1/me/lock/biometric/register/verify', async ({ request }) => {
        posted.push(await request.json());
        api.status = { ...api.status, biometricCount: 1 };
        return HttpResponse.json({ lock: api.status });
      }),
      http.delete('*/v1/me/lock/biometric', () => {
        api.status = { ...api.status, biometricCount: 0 };
        return HttpResponse.json({ lock: api.status });
      }),
    );
    const user = userEvent.setup();
    await renderApp('/settings/privacy');
    await user.click(await screen.findByRole('button', { name: 'Add this device' }, SLOW));
    expect(await screen.findByText('1 device can unlock without the PIN.', {}, SLOW)).toBeVisible();
    expect(posted).toEqual([{ response: { id: 'cred-1', type: 'public-key' } }]);
    await user.click(screen.getByRole('button', { name: 'Remove all' }));
    const confirm = await screen.findByRole('dialog', { name: /Stop unlocking/ });
    await user.click(within(confirm).getByRole('button', { name: 'Remove all' }));
    expect(await screen.findByText(/Use this device’s Windows Hello/, {}, SLOW)).toBeVisible();
  });
});
