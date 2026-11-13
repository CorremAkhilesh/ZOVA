import { QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { axe } from '@/test/axe';
import { HttpResponse, http, server } from '@/test/msw';
import { renderApp } from '@/test/render-app';
import { lastSocket } from '@/test/socket-mock';
import { applyAccountChange, chatSettingsQuery } from './chat-settings';

const settingsReply = (keepChatsArchived: boolean) =>
  HttpResponse.json({ settings: { keepChatsArchived } });

describe('Settings → Chats', () => {
  it('shows a loading state, then the switch (on by default), with no axe violations', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('*/v1/me/chat-settings', async () => {
        await gate;
        return settingsReply(true);
      }),
    );
    const { container } = await renderApp('/settings/chats');
    expect(await screen.findByLabelText('Loading')).toHaveAttribute('aria-busy', 'true');
    release();
    const toggle = await screen.findByRole('switch', { name: /Keep chats archived/ });
    expect(toggle).toBeChecked();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows an error when the settings cannot load', async () => {
    server.use(http.get('*/v1/me/chat-settings', () => HttpResponse.json({}, { status: 500 })));
    await renderApp('/settings/chats');
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load your chat settings.');
  });

  it('saves at once, and rolls back when the server refuses', async () => {
    const user = userEvent.setup();
    const saved: unknown[] = [];
    server.use(
      http.get('*/v1/me/chat-settings', () => settingsReply(true)),
      http.patch('*/v1/me/chat-settings', async ({ request }) => {
        const body = (await request.json()) as { keepChatsArchived: boolean };
        saved.push(body);
        if (saved.length > 1) return HttpResponse.json({}, { status: 500 });
        return settingsReply(body.keepChatsArchived);
      }),
    );
    await renderApp('/settings/chats');
    const toggle = await screen.findByRole('switch', { name: /Keep chats archived/ });
    await user.click(toggle);
    expect(toggle).not.toBeChecked();
    await waitFor(() => expect(saved).toEqual([{ keepChatsArchived: false }]));
    await user.click(toggle);
    await waitFor(() => expect(saved).toHaveLength(2));
    await waitFor(() => expect(toggle).not.toBeChecked());
  });

  it('follows a change made on another device', async () => {
    server.use(http.get('*/v1/me/chat-settings', () => settingsReply(true)));
    await renderApp('/settings/chats');
    const toggle = await screen.findByRole('switch', { name: /Keep chats archived/ });
    await waitFor(() => expect(lastSocket()).toBeDefined());
    act(() => lastSocket().receive('settings:updated', { settings: { keepChatsArchived: false } }));
    await waitFor(() => expect(toggle).not.toBeChecked());
  });

  it('is linked from the Settings menu', async () => {
    await renderApp('/settings');
    const menu = await screen.findByRole('navigation', { name: 'Account' });
    expect(within(menu).getByRole('link', { name: /How your chat list behaves/ })).toHaveAttribute(
      'href',
      '/settings/chats',
    );
  });
});

describe('account changes', () => {
  it('stores pushed settings, and refreshes settings and blocks after a reconnect', async () => {
    const client = new QueryClient();
    applyAccountChange(client, { kind: 'settings', settings: { keepChatsArchived: false } });
    expect(client.getQueryData(chatSettingsQuery.queryKey)).toEqual({ keepChatsArchived: false });
    client.setQueryData(['me', 'blocks'], []);
    applyAccountChange(client, { kind: 'reconnected' });
    expect(client.getQueryState(chatSettingsQuery.queryKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(['me', 'blocks'])?.isInvalidated).toBe(true);
  });
});
