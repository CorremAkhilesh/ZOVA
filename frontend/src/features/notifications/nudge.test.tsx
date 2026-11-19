import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { brand } from '@zuvo/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from '@/test/axe';
import { DESKTOP_WIDTH, MOBILE_WIDTH, renderApp } from '@/test/render-app';
import { NUDGE_LATER_KEY, nudgeFor } from './nudge';
import { installPushBrowser, restorePushBrowser, servePush } from './test-utils';

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 15_000 };
const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

afterEach(() => {
  cleanup();
  restorePushBrowser();
  vi.restoreAllMocks();
});

const screenStep = (name: string | RegExp) => screen.findByRole('dialog', { name }, SLOW);
const banner = () => screen.findByRole('region', { name: 'Notification reminder' }, SLOW);

describe('who gets nudged', () => {
  const device = { later: false, off: false, screenOpen: false };
  it('the full-screen step first; after "Later", the banner; nothing once on or impossible', () => {
    expect(nudgeFor('ask', device)).toBe('screen');
    expect(nudgeFor('ios-install', device)).toBe('screen');
    expect(nudgeFor('denied', device)).toBe('screen');
    expect(nudgeFor('ask', { ...device, later: true })).toBe('banner');
    expect(nudgeFor('denied', { ...device, later: true, screenOpen: true })).toBe('screen');
    // Turned off on purpose in Settings: a reminder only.
    expect(nudgeFor('off', device)).toBe('banner');
    for (const status of ['on', 'server-off', 'unsupported', undefined] as const) {
      expect(nudgeFor(status, device)).toBeNull();
    }
    expect(nudgeFor('ask', { ...device, off: true })).toBeNull();
  });
});

describe('"Turn on notifications" after sign-in', () => {
  it('asks only after the big button, subscribes, and goes; no axe violations', async () => {
    const api = servePush();
    const browser = installPushBrowser({ permission: 'default', answer: 'granted', nudge: true });
    const { container } = await renderApp('/chats', { width: MOBILE_WIDTH });
    const step = await screenStep('Turn on notifications');
    expect(browser.Notification.requestPermission).not.toHaveBeenCalled();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent
      .setup()
      .click(within(step).getByRole('button', { name: 'Turn on notifications' }));
    expect(browser.Notification.requestPermission).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(api.calls.some((c) => c.path === '/v1/me/push/subscription')).toBe(true),
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('region', { name: 'Notification reminder' })).toBeNull();
  });

  it('"Later" leaves a banner that cannot be closed, and its button turns them on', async () => {
    servePush();
    installPushBrowser({ permission: 'default', answer: 'granted', nudge: true });
    const { container } = await renderApp('/chats', { width: DESKTOP_WIDTH });
    const step = await screenStep('Turn on notifications');
    await userEvent.setup().click(within(step).getByRole('button', { name: 'Later' }));
    const bar = await banner();
    expect(bar).toHaveTextContent('Notifications are off');
    expect(within(bar).queryByRole('button', { name: /close|not now/i })).toBeNull();
    expect(localStorage.getItem(NUDGE_LATER_KEY)).not.toBeNull();
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.setup().click(within(bar).getByRole('button', { name: 'Turn on' }));
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Notification reminder' })).toBeNull(),
    );
  });

  it('blocked: the steps for this browser, and the banner reopens them', async () => {
    servePush();
    installPushBrowser({ permission: 'denied', nudge: true });
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    const step = await screenStep('Notifications are blocked');
    expect(step).toHaveTextContent('Site settings');
    await userEvent.setup().click(within(step).getByRole('button', { name: 'Later' }));
    const bar = await banner();
    expect(bar).toHaveTextContent(`Your browser blocks notifications from ${brand.name}`);
    await userEvent.setup().click(within(bar).getByRole('button', { name: 'How to' }));
    expect(await screenStep('Notifications are blocked')).toBeInTheDocument();
  });

  it('on an iPhone outside the installed app: Add to Home Screen first', async () => {
    servePush();
    installPushBrowser({ userAgent: IPHONE, nudge: true });
    const { container } = await renderApp('/chats', { width: MOBILE_WIDTH });
    const step = await screenStep(`Add ${brand.name} to your Home Screen first`);
    expect(step).toHaveTextContent('Add to Home Screen');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('nothing while push is on here, or when the server has no key', async () => {
    servePush();
    installPushBrowser({ permission: 'granted', subscribed: true, nudge: true });
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    await screen.findByRole('heading', { name: 'Chats' }, SLOW);
    await act(() => new Promise((resolve) => setTimeout(resolve, 300)));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Notification reminder' })).toBeNull();
  });

  it('tells the server what this device can do (for Admin → Notifications)', async () => {
    const api = servePush();
    installPushBrowser({ permission: 'granted', subscribed: true });
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    await waitFor(() =>
      expect(api.calls).toContainEqual({
        method: 'PUT',
        path: '/v1/me/push/client',
        body: { permission: 'granted', installed: false, enabled: true },
      }),
    );
  });
});
