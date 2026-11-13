import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLockStore } from './store';

export const SLOW = { timeout: 15_000 };

/** Test-only: Windows Hello / fingerprint available (or not) on this "device". */
export function stubBiometric(available: boolean | 'missing') {
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  Object.defineProperty(window, 'PublicKeyCredential', {
    configurable: true,
    value:
      available === 'missing'
        ? undefined
        : { isUserVerifyingPlatformAuthenticatorAvailable: () => Promise.resolve(available) },
  });
}

export function resetLockState() {
  useLockStore.getState().relockChats();
  useLockStore.setState({ appLocked: false, started: false, pinSet: null, setup: null });
  stubBiometric('missing');
}

/** Types a PIN on the pad named `label` (inside `scope`) and presses Enter. */
export async function typePin(label: string | RegExp, pin: string, scope?: HTMLElement) {
  const where = scope ? within(scope) : screen;
  const pad = await where.findByRole('group', { name: label }, SLOW);
  pad.focus();
  await userEvent.setup().keyboard(`${pin}{Enter}`);
}
