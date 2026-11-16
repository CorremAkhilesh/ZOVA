import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { useInstallStore } from './install-store';

function firePrompt(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn(async () => {}),
    userChoice: Promise.resolve({ outcome, platform: 'web' }),
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

const iosUserAgent = () =>
  vi
    .spyOn(navigator, 'userAgent', 'get')
    .mockReturnValue(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
    );

afterEach(() => {
  vi.restoreAllMocks();
  useInstallStore.setState({
    promptEvent: null,
    installed: false,
    bannerDismissed: false,
    iosSheetOpen: false,
  });
});

describe('install (Chrome / Edge / Android)', () => {
  it('hides everything until the browser offers installation', async () => {
    await renderApp('/settings', { width: DESKTOP_WIDTH });
    expect(screen.queryByRole('button', { name: 'Install app' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('complementary', { name: 'Install the app' }),
    ).not.toBeInTheDocument();
  });

  it('captures the prompt, shows the settings button, and installs on click', async () => {
    const user = userEvent.setup();
    await renderApp('/settings', { width: DESKTOP_WIDTH });
    const event = firePrompt('accepted');
    expect(event.defaultPrevented).toBe(true);

    await user.click(await screen.findByRole('button', { name: 'Install app' }));
    expect(event.prompt).toHaveBeenCalledOnce();
    expect(await screen.findByText(/Already installed/)).toBeInTheDocument();
    // The "Install the app" bar lives in the chat list only (promo-bar.test.tsx).
    expect(
      screen.queryByRole('complementary', { name: 'Install the app' }),
    ).not.toBeInTheDocument();
  });

  it('hides install UI after the appinstalled event', async () => {
    await renderApp('/settings', { width: DESKTOP_WIDTH });
    firePrompt();
    expect(await screen.findByRole('button', { name: 'Install app' })).toBeInTheDocument();
    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });
    expect(screen.queryByRole('button', { name: 'Install app' })).not.toBeInTheDocument();
  });
});

describe('install (iOS Safari)', () => {
  it('opens the Share → Add to Home Screen sheet', async () => {
    iosUserAgent();
    const user = userEvent.setup();
    await renderApp('/settings', { width: DESKTOP_WIDTH });
    await user.click(screen.getByRole('button', { name: 'Install app' }));
    const sheet = await screen.findByRole('dialog', { name: 'Add to Home Screen' });
    expect(sheet).toHaveTextContent('Tap the Share button');
    await user.click(screen.getByRole('button', { name: 'Got it' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows nothing when already running from the Home Screen', async () => {
    iosUserAgent();
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    await renderApp('/settings', { width: DESKTOP_WIDTH });
    expect(screen.queryByRole('button', { name: 'Install app' })).not.toBeInTheDocument();
    Reflect.deleteProperty(navigator, 'standalone');
  });
});
