import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { brand } from '@zuvo/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGlobalSearch } from '@/features/search/store';
import { axe } from '@/test/axe';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { lastSocket } from '@/test/socket-mock';
import { isIpHost, platformBiometricAvailable } from './biometric';
import { APP_LOCK_FLAG, useLockStore } from './store';
import { serveLock } from './test-server';
import { resetLockState, SLOW, stubBiometric, typePin } from './test-utils';

vi.setConfig({ testTimeout: 40_000 });
vi.mock('@simplewebauthn/browser', () => ({
  startRegistration: vi.fn(async () => ({ id: 'cred-1' })),
  startAuthentication: vi.fn(async () => ({ id: 'cred-1', type: 'public-key' })),
}));

beforeEach(() => {
  resetLockState();
  useGlobalSearch.setState({ open: false, initial: '' });
});
afterEach(() => vi.useRealTimers());

const LOCKED = `${brand.name} is locked`;
const lockScreen = () => screen.findByRole('dialog', { name: LOCKED }, SLOW);

describe('app lock', () => {
  it('locks when the app opens; nothing behind it can be reached; the PIN opens it', async () => {
    serveLock('1234', { appLock: { enabled: true, idleMinutes: 5 } });
    const { container } = await renderApp('/chats', { width: DESKTOP_WIDTH });
    const dialog = await lockScreen();
    expect(within(dialog).getByRole('img', { name: brand.name })).toBeInTheDocument();
    await waitFor(() => expect(container).toHaveAttribute('inert'));
    expect(await axe(dialog)).toHaveNoViolations();
    await typePin('Enter your PIN', '1234', dialog);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: LOCKED })).toBeNull());
    expect(container).not.toHaveAttribute('inert');
    expect(localStorage.getItem(APP_LOCK_FLAG)).toBe('1');
  });

  it('starts locked straight away when this device knows app lock is on', async () => {
    localStorage.setItem(APP_LOCK_FLAG, '1');
    useLockStore.setState({ appLocked: true });
    serveLock('1234', { appLock: { enabled: true, idleMinutes: 5 } });
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    expect(await lockScreen()).toBeInTheDocument();
  });

  it('opens unlocked when app lock is off, and forgets the start-up flag', async () => {
    localStorage.setItem(APP_LOCK_FLAG, '1');
    useLockStore.setState({ appLocked: true });
    serveLock('1234');
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    await waitFor(() => expect(useLockStore.getState().appLocked).toBe(false));
    expect(localStorage.getItem(APP_LOCK_FLAG)).toBeNull();
  });

  it('locks after the idle time, and when the tab comes back after that long', async () => {
    serveLock('1234', { appLock: { enabled: true, idleMinutes: 1 } });
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    await typePin('Enter your PIN', '1234', await lockScreen());
    await waitFor(() => expect(useLockStore.getState().appLocked).toBe(false));
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    });
    // The idle check started with real timers: start it again under the fake ones.
    act(() => useLockStore.setState({ appLocked: true }));
    act(() => useLockStore.setState({ appLocked: false }));
    act(() => vi.advanceTimersByTime(30_000));
    window.dispatchEvent(new Event('pointerdown'));
    act(() => vi.advanceTimersByTime(45_000));
    expect(useLockStore.getState().appLocked).toBe(false);
    act(() => vi.advanceTimersByTime(20_000));
    expect(useLockStore.getState().appLocked).toBe(true);
    expect(await lockScreen()).toBeInTheDocument();

    act(() => useLockStore.setState({ appLocked: false }));
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    act(() => vi.advanceTimersByTime(120_000));
    expect(useLockStore.getState().appLocked).toBe(false);
    visibility.mockReturnValue('visible');
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    expect(useLockStore.getState().appLocked).toBe(true);
    visibility.mockRestore();
  });

  it('"Lock app" in the palette locks at once when I have a PIN', async () => {
    serveLock('1234');
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    await waitFor(() => expect(useLockStore.getState().pinSet).toBe(true));
    act(() => useGlobalSearch.getState().show('>lock app'));
    const box = await screen.findByRole('combobox', {}, SLOW);
    box.focus();
    await userEvent.setup().keyboard('{Enter}');
    expect(await lockScreen()).toBeInTheDocument();
  });

  it('after "Forgot PIN?" by email, opens and asks for a new PIN', async () => {
    const api = serveLock('1234', { appLock: { enabled: true, idleMinutes: 5 } });
    const user = userEvent.setup();
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    const dialog = await lockScreen();
    await user.click(within(dialog).getByRole('button', { name: 'Forgot PIN?' }));
    await user.click(within(dialog).getByRole('button', { name: 'Email me a code' }));
    const first = await within(dialog).findByRole('textbox', { name: /Digit 1/ }, SLOW);
    first.focus();
    await user.keyboard('123456');
    await waitFor(() => expect(api.pin).toBeNull());
    expect(
      await screen.findByRole('dialog', { name: 'Set PIN' }, SLOW),
    ).toHaveAccessibleDescription('Your PIN was reset. Choose a new one.');
    expect(useLockStore.getState().appLocked).toBe(false);
  });

  it('refetches the lock status on lock:updated from another device', async () => {
    const api = serveLock(null);
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    await waitFor(() => expect(useLockStore.getState().pinSet).toBe(false));
    await waitFor(() => expect(lastSocket()).toBeDefined());
    api.pin = '1234';
    api.status = { ...api.status, pinSet: true };
    act(() => lastSocket().receive('lock:updated', {}));
    await waitFor(() => expect(useLockStore.getState().pinSet).toBe(true), SLOW);
  });
});

describe('Unlock with Windows Hello / fingerprint', () => {
  async function lockedApp(biometricCount: number) {
    serveLock('1234', { appLock: { enabled: true, idleMinutes: 5 }, biometricCount });
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    return lockScreen();
  }
  const button = { name: 'Unlock with Windows Hello / fingerprint' };

  it('is hidden when the browser has no WebAuthn', async () => {
    stubBiometric('missing');
    const dialog = await lockedApp(1);
    await within(dialog).findByRole('group', { name: 'Enter your PIN' });
    expect(within(dialog).queryByRole('button', button)).toBeNull();
  });

  it('is hidden without a built-in authenticator', async () => {
    stubBiometric(false);
    const dialog = await lockedApp(1);
    await within(dialog).findByRole('group', { name: 'Enter your PIN' });
    expect(within(dialog).queryByRole('button', button)).toBeNull();
  });

  it('is hidden on an IP address, which WebAuthn refuses', async () => {
    stubBiometric(true);
    expect(isIpHost('127.0.0.1')).toBe(true);
    expect(isIpHost('[::1]')).toBe(true);
    expect(isIpHost('app.zuvo.corremadvisory.com')).toBe(false);
    expect(await platformBiometricAvailable('127.0.0.1')).toBe(false);
    expect(await platformBiometricAvailable('localhost')).toBe(true);
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
    expect(await platformBiometricAvailable('localhost')).toBe(false);
  });

  it('shows when supported with a device added, and unlocks', async () => {
    stubBiometric(true);
    const sent: unknown[] = [];
    server.use(
      http.post('*/v1/me/lock/biometric/unlock/options', () =>
        HttpResponse.json({ options: { challenge: 'xyz' } }),
      ),
      http.post('*/v1/me/lock/biometric/unlock/verify', async ({ request }) => {
        sent.push(await request.json());
        return HttpResponse.json({ ok: true });
      }),
    );
    const dialog = await lockedApp(1);
    await userEvent.setup().click(await within(dialog).findByRole('button', button, SLOW));
    await waitFor(() => expect(useLockStore.getState().appLocked).toBe(false));
    expect(sent).toEqual([{ response: { id: 'cred-1', type: 'public-key' } }]);
  });

  it('is hidden with no device added', async () => {
    stubBiometric(true);
    const dialog = await lockedApp(0);
    await within(dialog).findByRole('group', { name: 'Enter your PIN' });
    expect(within(dialog).queryByRole('button', button)).toBeNull();
  });
});
