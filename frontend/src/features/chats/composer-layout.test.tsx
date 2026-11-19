import { act, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { brand } from '@zuvo/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSyncStore } from '@/features/sync/store';
import { useKeyboardHeight, visibleAppHeight } from '@/lib/use-keyboard-height';
import { axe } from '@/test/axe';
import { chatFixture } from '@/test/chat-fixtures';
import { DESKTOP_WIDTH, MOBILE_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { COMPOSER_MAX_LINES, fitTextarea } from './use-auto-grow';

async function open(width = DESKTOP_WIDTH) {
  await seedLocal([chatFixture()]);
  const result = await renderApp('/chats/c1', { width });
  const input = await screen.findByRole('textbox', { name: 'Write a message' });
  await waitFor(() => expect(useSyncStore.getState().client).not.toBeNull());
  return { ...result, input };
}

/** The rounded box around the text: emoji, text and attach live inside it. */
const pillOf = (input: HTMLElement) => input.parentElement as HTMLElement;

describe('the composer pill', () => {
  it('keeps emoji, the text and attach inside one box, with the mic outside it', async () => {
    const { input, container } = await open();
    const pill = within(pillOf(input));
    expect(pill.getByRole('button', { name: 'Emoji' })).toBeInTheDocument();
    expect(pill.getByRole('button', { name: 'Attach a file' })).toBeInTheDocument();
    expect(pill.queryByRole('button', { name: 'Record a voice note' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record a voice note' })).toBeInTheDocument();
    // Desktop: no camera button (there is no camera to point at the room).
    expect(pill.queryByRole('button', { name: 'Camera' })).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('on a phone offers the camera in the box, which makes room once there is text', async () => {
    const user = userEvent.setup();
    const { input } = await open(MOBILE_WIDTH);
    expect(within(pillOf(input)).getByRole('button', { name: 'Camera' })).toBeInTheDocument();
    await user.type(input, 'hi');
    expect(screen.queryByRole('button', { name: 'Camera' })).not.toBeInTheDocument();
    // Attach stays, so a photo can still go with the text being written.
    expect(
      within(pillOf(input)).getByRole('button', { name: 'Attach a file' }),
    ).toBeInTheDocument();
  });

  it('the camera opens the send sheet with the picture taken', async () => {
    const user = userEvent.setup();
    await open(MOBILE_WIDTH);
    const photo = new File([new Uint8Array(8)], 'camera.png', { type: 'image/png' });
    await user.upload(screen.getByTestId('pick-camera'), photo);
    expect(await screen.findByRole('dialog', { name: 'Send 1 file' })).toBeInTheDocument();
  });
});

describe('auto-grow (fitTextarea)', () => {
  function field(scrollHeight: number, border = '0px') {
    const element = document.createElement('textarea');
    Object.assign(element.style, {
      lineHeight: '22px',
      paddingTop: '11px',
      paddingBottom: '11px',
      borderTopWidth: border,
      borderBottomWidth: border,
      borderStyle: 'solid',
    });
    Object.defineProperty(element, 'scrollHeight', { configurable: true, value: scrollHeight });
    document.body.append(element);
    return element;
  }
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('one line: exactly one line high, and no scrollbar (no ▲▼ on Windows)', () => {
    const element = field(44, '1px');
    fitTextarea(element);
    // The borders count, or one line would overflow by 2 px and show a scrollbar.
    expect(element.style.height).toBe('46px');
    expect(element.style.overflowY).toBe('hidden');
  });

  it(`grows line by line up to ${COMPOSER_MAX_LINES}, then scrolls inside`, () => {
    const three = field(22 * 3 + 22);
    fitTextarea(three);
    expect(three.style.height).toBe('88px');
    expect(three.style.overflowY).toBe('hidden');

    const twelve = field(22 * 12 + 22);
    fitTextarea(twelve);
    expect(twelve.style.height).toBe(`${22 * COMPOSER_MAX_LINES + 22}px`);
    expect(twelve.style.overflowY).toBe('auto');
  });
});

describe('Help → About', () => {
  it('names the company with one full stop, not two', async () => {
    await renderApp('/help/about', { width: DESKTOP_WIDTH });
    const subtitle = await screen.findByText(`${brand.name} by ${brand.company}`);
    expect(subtitle.textContent).not.toMatch(/\.\.$/);
  });
});

describe('on-screen keyboard (useKeyboardHeight)', () => {
  it('ignores browser bars, and follows a keyboard', () => {
    expect(visibleAppHeight(812, 760)).toBeNull();
    expect(visibleAppHeight(812, 476.4)).toBe(476);
  });

  it('sets --app-height while a keyboard covers the window, and clears it after', () => {
    const listeners: Record<string, () => void> = {};
    const viewport = {
      height: 812,
      addEventListener: (type: string, listener: () => void) => {
        listeners[type] = listener;
      },
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal('visualViewport', viewport);
    vi.stubGlobal('innerHeight', 812);
    const root = document.documentElement;
    const { unmount } = renderHook(() => useKeyboardHeight());
    expect(root.style.getPropertyValue('--app-height')).toBe('');
    viewport.height = 450;
    act(() => listeners.resize?.());
    expect(root.style.getPropertyValue('--app-height')).toBe('450px');
    viewport.height = 812;
    act(() => listeners.resize?.());
    expect(root.style.getPropertyValue('--app-height')).toBe('');
    unmount();
    vi.unstubAllGlobals();
  });
});
