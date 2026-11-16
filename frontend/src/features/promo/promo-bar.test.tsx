import { act, cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useInstallStore } from '@/features/install/install-store';
import { PUSH_CARD_DISMISSED_KEY, usePushPrefs } from '@/features/notifications/prefs';
import {
  installPushBrowser,
  restorePushBrowser,
  servePush,
} from '@/features/notifications/test-utils';
import { axe } from '@/test/axe';
import { chatFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { resetPromoVisit } from './PromoBar';
import { PROMO_DELAY_MS } from './ready';

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 15_000 };

afterEach(() => {
  // Unmount first: a bar that loses its reason while mounted closes for the visit.
  cleanup();
  resetPromoVisit();
  restorePushBrowser();
  vi.restoreAllMocks();
  useInstallStore.setState({ promptEvent: null, installed: false, bannerDismissed: false });
});

function firePrompt() {
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: vi.fn(async () => {}),
    userChoice: Promise.resolve({ outcome: 'dismissed', platform: 'web' }),
  });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

async function openChats() {
  server.use(
    http.get('*/v1/chats/:id/messages', () => HttpResponse.json({ items: [], hasMore: false })),
  );
  await seedLocal([chatFixture({ id: 'c-asha', seq: 3 })]);
  const app = await renderApp('/chats', { width: DESKTOP_WIDTH });
  await screen.findByText('Asha Verma', {}, SLOW);
  return app;
}
const installBar = () => screen.findByRole('complementary', { name: /^Install the app/ }, SLOW);
const pushBar = () => screen.findByRole('complementary', { name: /Get notified/ }, SLOW);
const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

describe('chat list promo bar', () => {
  it('"Install the app": after the rows, installs on click; no axe violations', async () => {
    const { container } = await openChats();
    const event = firePrompt();
    expect(screen.queryByRole('complementary', { name: /^Install the app/ })).toBeNull();
    const bar = await installBar();
    expect(bar).toHaveTextContent('Install the app for quick access');
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.setup().click(within(bar).getByRole('button', { name: 'Install' }));
    expect(event.prompt).toHaveBeenCalledOnce();
  });

  it('remembers "Not now" for the install bar on this device', async () => {
    await openChats();
    firePrompt();
    await userEvent
      .setup()
      .click(within(await installBar()).getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('complementary', { name: /^Install the app/ })).toBeNull();
    expect(JSON.parse(localStorage.getItem('zuvo-install') ?? '{}')).toMatchObject({
      state: { bannerDismissed: true },
    });
  });

  it('never shows both: notifications first, and nothing replaces them this visit', async () => {
    servePush();
    installPushBrowser({ permission: 'default' });
    await openChats();
    firePrompt();
    await pushBar();
    expect(screen.getAllByTestId('promo-bar')).toHaveLength(1);
    expect(screen.queryByRole('complementary', { name: /^Install the app/ })).toBeNull();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Not now' }));
    await wait(PROMO_DELAY_MS + 300);
    expect(screen.queryByTestId('promo-bar')).toBeNull();
    expect(localStorage.getItem(PUSH_CARD_DISMISSED_KEY)).toBe('1');
  });

  it('on a later visit with notifications dismissed, offers the install', async () => {
    servePush();
    installPushBrowser({ permission: 'default' });
    localStorage.setItem(PUSH_CARD_DISMISSED_KEY, '1');
    usePushPrefs.getState().reload();
    await openChats();
    firePrompt();
    expect(await installBar()).toBeInTheDocument();
    expect(screen.getAllByTestId('promo-bar')).toHaveLength(1);
  });

  it('lies over the list: out of flow, after the list, nothing before it moves', async () => {
    await openChats();
    const scroller = document.querySelector<HTMLElement>('[data-slot="scroll-area"]');
    if (!scroller?.parentElement) throw new Error('no chat list');
    const pane = scroller.parentElement;
    const before = [...pane.children].indexOf(scroller);
    const firstRowBefore = scroller.firstElementChild;
    firePrompt();
    const bar = await installBar();
    expect(bar).toHaveClass('absolute');
    expect(pane).toHaveClass('relative');
    expect(scroller.contains(bar)).toBe(false);
    expect([...pane.children].indexOf(scroller)).toBe(before);
    expect([...pane.children].indexOf(bar)).toBeGreaterThan(before);
    expect(scroller.firstElementChild).toBe(firstRowBefore);
    // Room to scroll the last row clear of the bar, added at the very end of the list.
    // Wait for the spacer first: `expect(scroller.lastElementChild)` would read the list too early.
    const spacer = await screen.findByTestId('promo-spacer');
    expect(scroller.lastElementChild).toBe(spacer);
  });

  it('stays away while searching', async () => {
    const user = userEvent.setup();
    await openChats();
    firePrompt();
    screen.getByRole('searchbox', { name: 'Search chats' }).focus();
    await user.keyboard('asha');
    expect(screen.getByRole('searchbox', { name: 'Search chats' })).toHaveValue('asha');
    await wait(PROMO_DELAY_MS + 300);
    expect(screen.queryByTestId('promo-bar')).toBeNull();
  });
});
