import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_PUSH_SETTINGS } from '@zuvo/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from '@/test/axe';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { lastSocket } from '@/test/socket-mock';
import { PUSH_ENABLED_KEY } from './prefs';
import { deviceFixture, installPushBrowser, restorePushBrowser, servePush } from './test-utils';

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 15_000 };

afterEach(restorePushBrowser);

const openSettings = () => renderApp('/settings/notifications', { width: DESKTOP_WIDTH });
const section = (name: string) => screen.findByRole('heading', { name }, SLOW);
const pushSwitch = () => screen.getByRole('switch', { name: /Push notifications/ });

describe('Settings → Notifications: push', () => {
  it('shows loading, then the sections; no axe violations', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('*/v1/me/push', async () => {
        await gate;
        return HttpResponse.json({
          publicKey: null,
          settings: DEFAULT_PUSH_SETTINGS,
          devices: [deviceFixture()],
        });
      }),
    );
    const { container } = await openSettings();
    expect((await screen.findAllByLabelText('Loading', {}, SLOW)).length).toBeGreaterThan(0);
    release();
    await section('This device');
    expect(screen.getByRole('heading', { name: 'All your devices' })).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'My devices with notifications' }),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows an error with a retry', async () => {
    let fail = true;
    server.use(
      http.get('*/v1/me/push', () =>
        fail
          ? HttpResponse.json({ code: 'X', message: 'x', requestId: 'r' }, { status: 500 })
          : HttpResponse.json({ publicKey: null, settings: DEFAULT_PUSH_SETTINGS, devices: [] }),
      ),
    );
    await openSettings();
    const alert = await screen.findByText('Couldn’t load your notification settings.', {}, SLOW);
    fail = false;
    await userEvent.setup().click(within(alert).getByRole('button', { name: 'Try again' }));
    await section('This device');
  });

  it('empty: no devices yet, server without push, no test button', async () => {
    await openSettings();
    await section('This device');
    expect(screen.getByText('None of your devices gets notifications yet.')).toBeInTheDocument();
    expect(
      screen.getByText('Push notifications aren’t set up on this server yet.'),
    ).toBeInTheDocument();
    expect(pushSwitch()).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Send test notification' })).toBeNull();
  });

  it('turns push off and on for this device', async () => {
    const api = servePush();
    const browser = installPushBrowser({ permission: 'granted', subscribed: true });
    await openSettings();
    await section('This device');
    await waitFor(() => expect(pushSwitch()).toBeChecked());
    expect(screen.getByText('Allowed by your browser.')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(pushSwitch());
    await waitFor(() => expect(pushSwitch()).not.toBeChecked());
    expect(localStorage.getItem(PUSH_ENABLED_KEY)).toBe('0');
    await waitFor(() =>
      expect(api.calls).toContainEqual({
        method: 'DELETE',
        path: '/v1/me/push/subscription',
        body: { endpoint: browser.subscription.endpoint },
      }),
    );
    expect(browser.subscription.unsubscribe).toHaveBeenCalled();
    await user.click(pushSwitch());
    await waitFor(() => expect(pushSwitch()).toBeChecked());
    await waitFor(() => expect(browser.pushManager.subscribe).toHaveBeenCalled());
  });

  it('a blocked browser shows how to unblock and cannot be switched on', async () => {
    servePush();
    installPushBrowser({ permission: 'denied' });
    const { container } = await openSettings();
    await section('This device');
    expect(pushSwitch()).toBeDisabled();
    expect(screen.getByRole('note')).toHaveTextContent('Notifications are blocked');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('saves preview and sound, and follows push:updated from another device', async () => {
    const api = servePush();
    await openSettings();
    await section('All your devices');
    const user = userEvent.setup();
    await user.click(screen.getByRole('switch', { name: /Show message preview/ }));
    await waitFor(() =>
      expect(api.calls).toContainEqual({
        method: 'PUT',
        path: '/v1/me/push/settings',
        body: { showPreview: false },
      }),
    );
    expect(screen.getByRole('switch', { name: /Show message preview/ })).not.toBeChecked();
    api.push = { ...api.push, settings: { showPreview: true, sound: false } };
    act(() => lastSocket().receive('push:updated', { settings: api.push.settings }));
    await waitFor(() => expect(screen.getByRole('switch', { name: /^Sound/ })).not.toBeChecked());
    expect(screen.getByRole('switch', { name: /Show message preview/ })).toBeChecked();
  });

  it('puts a refused change back', async () => {
    servePush();
    server.use(
      http.put('*/v1/me/push/settings', () =>
        HttpResponse.json({ code: 'X', message: 'x', requestId: 'r' }, { status: 500 }),
      ),
    );
    await openSettings();
    await section('All your devices');
    await userEvent.setup().click(screen.getByRole('switch', { name: /^Sound/ }));
    expect(
      await screen.findByText('Couldn’t save that change. Try again.', {}, SLOW),
    ).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: /^Sound/ })).toBeChecked();
  });

  it('sends a test notification and says when no device got it', async () => {
    const api = servePush();
    await openSettings();
    await section('All your devices');
    const user = userEvent.setup();
    api.testSent = 2;
    await user.click(screen.getByRole('button', { name: 'Send test notification' }));
    expect(
      await screen.findByText('Test notification sent to 2 devices.', {}, SLOW),
    ).toBeInTheDocument();
    api.testSent = 0;
    await user.click(screen.getByRole('button', { name: 'Send test notification' }));
    expect(await screen.findByText(/No device received it/, {}, SLOW)).toBeInTheDocument();
  });

  it('lists my devices, marks this one, and removes another', async () => {
    const api = servePush({
      devices: [
        deviceFixture(),
        deviceFixture({
          id: 'd2',
          label: 'Safari on iPhone',
          current: false,
          lastUsedAt: new Date().toISOString(),
        }),
      ],
    });
    await openSettings();
    await section('My devices with notifications');
    await screen.findByText('Safari on iPhone', {}, SLOW);
    const heading = screen.getByRole('heading', { name: 'My devices with notifications' });
    const list = within(heading.closest('section') as HTMLElement).getByRole('list');
    expect(within(list).getByText('This device')).toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: /Chrome on Windows/ })).toBeNull();
    await userEvent
      .setup()
      .click(within(list).getByRole('button', { name: 'Stop notifications on Safari on iPhone' }));
    await waitFor(() => expect(screen.queryByText('Safari on iPhone')).toBeNull());
    expect(api.calls).toContainEqual({
      method: 'DELETE',
      path: '/v1/me/push/devices/d2',
      body: undefined,
    });
  });
});
