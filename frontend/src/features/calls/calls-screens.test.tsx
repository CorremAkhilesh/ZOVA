import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CallLogEntry, CallView } from '@zuvo/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from '@/test/axe';
import { chatFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, MOBILE_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { lastSocket } from '@/test/socket-mock';
import { IDLE } from './machine';
import { useCallStore } from './store';

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 15_000 };
afterEach(() => useCallStore.setState({ state: IDLE, minimized: false }));

const entry = (overrides: Partial<CallLogEntry>): CallLogEntry => ({
  id: 'k1',
  chatId: 'c1',
  peerId: 'u-asha',
  kind: 'voice',
  direction: 'incoming',
  outcome: 'answered',
  startedAt: new Date(Date.now() - 3600_000).toISOString(),
  durationSeconds: 151,
  ...overrides,
});

const ringing = (overrides: Partial<CallView> = {}): CallView => ({
  id: 'call1',
  chatId: 'c1',
  kind: 'voice',
  callerId: 'u-asha',
  calleeId: 'u-test',
  status: 'ringing',
  outcome: null,
  startedAt: new Date().toISOString(),
  ringingAt: null,
  answeredAt: null,
  endedAt: null,
  ...overrides,
});

const allowCalls = () =>
  server.use(http.get('*/v1/calls/access', () => HttpResponse.json({ enabled: true })));

describe('the Calls tab', () => {
  it('lists my calls: answered with its length, missed in red, and calls back', async () => {
    allowCalls();
    server.use(
      http.get('*/v1/calls', () =>
        HttpResponse.json({
          items: [
            entry({ id: 'k1' }),
            entry({ id: 'k2', outcome: 'missed', durationSeconds: 0 }),
            entry({ id: 'k3', direction: 'outgoing', outcome: 'declined', durationSeconds: 0 }),
          ],
          nextCursor: null,
        }),
      ),
    );
    await seedLocal([chatFixture()]);
    const { container } = await renderApp('/calls', { width: DESKTOP_WIDTH });
    const list = await screen.findByRole('list', { name: 'Calls' }, SLOW);
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(within(rows[0] as HTMLElement).getByText('· 2:31')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('Missed')).toBeInTheDocument();
    expect(within(rows[2] as HTMLElement).getByText('Declined')).toBeInTheDocument();
    // Named from the chat on this device, once it has loaded.
    expect(
      await within(rows[0] as HTMLElement).findByText('Asha Verma', {}, SLOW),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(
      within(rows[0] as HTMLElement).getByRole('button', { name: 'Call Asha Verma' }),
    );
    // The microphone is asked for first; jsdom has none, so the app says so and starts nothing.
    await waitFor(() =>
      expect(lastSocket().emitted.some((e) => e.event === 'call:start')).toBe(false),
    );
  });

  it('empty', async () => {
    await renderApp('/calls', { width: MOBILE_WIDTH });
    expect(await screen.findByText('No calls yet', {}, SLOW)).toBeInTheDocument();
  });

  it('an error, then a retry that works', async () => {
    let fail = true;
    server.use(
      http.get('*/v1/calls', () =>
        fail
          ? HttpResponse.json({ code: 'INTERNAL_ERROR', message: 'x' }, { status: 500 })
          : HttpResponse.json({ items: [entry({})], nextCursor: null }),
      ),
    );
    await renderApp('/calls', { width: MOBILE_WIDTH });
    expect(await screen.findByRole('alert', {}, SLOW)).toHaveTextContent('could not be loaded');
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('list', { name: 'Calls' }, SLOW)).toBeInTheDocument();
  });
});

describe('a call ringing for me', () => {
  it('shows who is calling, full screen, and Decline tells the server', async () => {
    await seedLocal([chatFixture()]);
    const { container } = await renderApp('/chats', { width: MOBILE_WIDTH });
    await waitFor(() => expect(lastSocket()).toBeTruthy());
    lastSocket().receive('call:incoming', { call: ringing(), silent: false });
    const dialog = await screen.findByRole('dialog', { name: 'Asha Verma' }, SLOW);
    expect(within(dialog).getByText('Incoming voice call')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Accept' })).toHaveFocus();
    expect(lastSocket().emitted).toContainEqual({
      event: 'call:ringing',
      payload: { callId: 'call1' },
    });
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Decline' }));
    expect(lastSocket().emitted).toContainEqual({
      event: 'call:decline',
      payload: { callId: 'call1' },
    });
    expect(await screen.findByText('Declined', {}, SLOW)).toBeInTheDocument();
  });

  it('answered on another of my devices: stops here', async () => {
    await seedLocal([chatFixture()]);
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    await waitFor(() => expect(lastSocket()).toBeTruthy());
    lastSocket().receive('call:incoming', { call: ringing(), silent: true });
    const dialog = await screen.findByRole('dialog', { name: 'Asha Verma' }, SLOW);
    expect(within(dialog).getByText('Quiet hours: ringing silently')).toBeInTheDocument();
    lastSocket().receive('call:update', { call: ringing({ status: 'active' }) });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Asha Verma' })).toBeNull());
  });
});

describe('calling someone', () => {
  const fakeMic = () => {
    const stop = vi.fn();
    const stream = { getTracks: () => [{ stop }], getAudioTracks: () => [] };
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => stream) },
    });
    return stop;
  };
  const dial = async (ack: unknown) => {
    allowCalls();
    await seedLocal([chatFixture()]);
    await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    const button = await screen.findByRole('button', { name: 'Voice call with Asha Verma' }, SLOW);
    const socket = lastSocket();
    socket.receive('connect');
    const fallback = socket.respond;
    socket.respond = (event, payload) => (event === 'call:start' ? ack : fallback(event, payload));
    await userEvent.click(button);
    return socket;
  };

  it('busy: says so, and lets go of the microphone', async () => {
    const stop = fakeMic();
    const socket = await dial({
      ok: true,
      data: {
        call: ringing({ status: 'ended', outcome: 'busy', callerId: 'u-test', calleeId: 'u-asha' }),
        busy: true,
      },
    });
    expect(socket.emitted).toContainEqual({
      event: 'call:start',
      payload: { chatId: 'c1', kind: 'voice' },
    });
    const dialog = await screen.findByRole('dialog', { name: 'Asha Verma' }, SLOW);
    expect(dialog).toHaveTextContent('On another call');
    expect(stop).toHaveBeenCalled();
  });

  it('calling → ringing → no answer', async () => {
    fakeMic();
    const call = ringing({ callerId: 'u-test', calleeId: 'u-asha' });
    const socket = await dial({ ok: true, data: { call, busy: false } });
    const dialog = await screen.findByRole('dialog', { name: 'Asha Verma' }, SLOW);
    expect(dialog).toHaveTextContent('Calling…');
    socket.receive('call:update', { call: { ...call, ringingAt: new Date().toISOString() } });
    await waitFor(() => expect(dialog).toHaveTextContent('Ringing…'));
    socket.receive('call:update', { call: { ...call, status: 'ended', outcome: 'missed' } });
    await waitFor(() => expect(dialog).toHaveTextContent('No answer'));
  });

  it('refused by the server: a clear message, no call screen', async () => {
    fakeMic();
    await dial({ ok: false, error: { code: 'CALLS_UNAVAILABLE', message: 'x' } });
    expect(
      await screen.findByText('Calls aren’t available for this person yet.', {}, SLOW),
    ).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Asha Verma' })).toBeNull();
  });
});

describe('the call button', () => {
  it('in a 1:1 chat for accounts with calls; never without', async () => {
    await seedLocal([chatFixture()]);
    await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    await screen.findByRole('heading', { name: 'Asha Verma' }, SLOW).catch(() => undefined);
    expect(screen.queryByRole('button', { name: 'Voice call with Asha Verma' })).toBeNull();
  });

  it('shows when calls are on', async () => {
    allowCalls();
    await seedLocal([chatFixture()]);
    await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    expect(
      await screen.findByRole('button', { name: 'Voice call with Asha Verma' }, SLOW),
    ).toBeEnabled();
  });
});
