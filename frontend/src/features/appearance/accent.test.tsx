import { QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_APPEARANCE, DEFAULT_QUIET_HOURS } from '@zuvo/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { QUIET_HOURS_KEY } from '@/features/quiet-hours/api';
import { applyAccountChange } from '@/features/settings/chat-settings';
import { axe } from '@/test/axe';
import { HttpResponse, http, server } from '@/test/msw';
import { renderApp } from '@/test/render-app';
import { lastSocket } from '@/test/socket-mock';
import { ACCENT_STORAGE_KEY, applyAccent, readStoredAccent } from './accent';
import { APPEARANCE_KEY, WALLPAPER_IMAGES_KEY } from './api';
import { serveAppearance } from './test-server';

const html = () => document.documentElement;

afterEach(() => {
  delete html().dataset.accent;
});

async function accentGroup() {
  await renderApp('/settings/appearance');
  return screen.findByRole('radiogroup', { name: 'Accent color' }, { timeout: 10_000 });
}

describe('Settings → Appearance: accent', () => {
  it('shows a loading state, then six named swatches with indigo picked; no axe violations', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('*/v1/me/appearance', async () => {
        await gate;
        return HttpResponse.json({ appearance: DEFAULT_APPEARANCE });
      }),
    );
    const { container } = await renderApp('/settings/appearance');
    expect(await screen.findByLabelText('Loading', {}, { timeout: 10_000 })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    release();
    const group = await screen.findByRole('radiogroup', { name: 'Accent color' });
    const names = within(group)
      .getAllByRole('radio')
      .map((radio) => radio.getAttribute('aria-label'));
    expect(names).toEqual(['Indigo', 'Teal', 'Violet', 'Rose', 'Amber', 'Sky']);
    expect(within(group).getByRole('radio', { name: 'Indigo' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows an error when the settings cannot load', async () => {
    server.use(http.get('*/v1/me/appearance', () => HttpResponse.json({}, { status: 500 })));
    await renderApp('/settings/appearance');
    expect(await screen.findByRole('alert', {}, { timeout: 10_000 })).toHaveTextContent(
      'Couldn’t load your appearance settings.',
    );
  });

  it('applies a new accent at once, remembers it on this device and saves it', async () => {
    const api = serveAppearance();
    const group = await accentGroup();
    await userEvent.setup().click(within(group).getByRole('radio', { name: 'Teal' }));
    await waitFor(() => expect(html().dataset.accent).toBe('teal'));
    expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBe('teal');
    await waitFor(() =>
      expect(api.requests).toEqual([
        { method: 'PATCH', path: '/v1/me/appearance', body: { accent: 'teal' } },
      ]),
    );
    expect(within(group).getByRole('radio', { name: 'Teal' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('moves with the arrow keys', async () => {
    const api = serveAppearance({ accent: 'sky' });
    const group = await accentGroup();
    await waitFor(() =>
      expect(within(group).getByRole('radio', { name: 'Sky' })).toHaveAttribute('tabindex', '0'),
    );
    within(group).getByRole('radio', { name: 'Sky' }).focus();
    await userEvent.setup().keyboard('{ArrowRight}');
    await waitFor(() => expect(api.requests.at(-1)?.body).toEqual({ accent: 'indigo' }));
    expect(within(group).getByRole('radio', { name: 'Indigo' })).toHaveFocus();
  });

  it('puts the accent back when the server refuses', async () => {
    const api = serveAppearance({ accent: 'rose' });
    const group = await accentGroup();
    await waitFor(() => expect(html().dataset.accent).toBe('rose'));
    api.failNextPatch = true;
    await userEvent.setup().click(within(group).getByRole('radio', { name: 'Amber' }));
    await waitFor(() => expect(api.requests).toHaveLength(1));
    await waitFor(() => expect(html().dataset.accent).toBe('rose'));
    expect(await screen.findByText('Couldn’t save. Your change was undone.')).toBeInTheDocument();
  });

  it('follows a change made on another device', async () => {
    serveAppearance();
    await accentGroup();
    await waitFor(() => expect(lastSocket()).toBeDefined());
    act(() =>
      lastSocket().receive('appearance:updated', {
        appearance: { ...DEFAULT_APPEARANCE, accent: 'violet' },
      }),
    );
    await waitFor(() => expect(html().dataset.accent).toBe('violet'));
  });

  it('is linked from the Settings menu', async () => {
    await renderApp('/settings');
    const menu = await screen.findByRole('navigation', { name: 'Account' });
    expect(
      within(menu).getByRole('link', { name: /Accent color and chat wallpaper/ }),
    ).toHaveAttribute('href', '/settings/appearance');
    expect(
      within(menu).getByRole('link', { name: /Push, sounds and quiet hours/ }),
    ).toHaveAttribute('href', '/settings/notifications');
  });
});

describe('accent storage', () => {
  it('reads back what was applied, and forgets the default', () => {
    applyAccent('amber');
    expect(readStoredAccent()).toBe('amber');
    expect(html().dataset.accent).toBe('amber');
    applyAccent('indigo');
    expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBeNull();
    localStorage.setItem(ACCENT_STORAGE_KEY, 'green');
    expect(readStoredAccent()).toBe('indigo');
  });
});

describe('account changes', () => {
  it('stores pushed appearance and quiet hours, and refetches both after a reconnect', () => {
    const client = new QueryClient();
    const appearance = { ...DEFAULT_APPEARANCE, dim: 50 };
    applyAccountChange(client, { kind: 'appearance', appearance });
    expect(client.getQueryData(APPEARANCE_KEY)).toEqual(appearance);
    const quietHours = { ...DEFAULT_QUIET_HOURS, mode: 'on' as const };
    applyAccountChange(client, { kind: 'quietHours', quietHours });
    expect(client.getQueryData(QUIET_HOURS_KEY)).toEqual(quietHours);
    client.setQueryData(WALLPAPER_IMAGES_KEY, []);
    applyAccountChange(client, { kind: 'reconnected' });
    expect(client.getQueryState(APPEARANCE_KEY)?.isInvalidated).toBe(true);
    expect(client.getQueryState(QUIET_HOURS_KEY)?.isInvalidated).toBe(true);
  });
});
