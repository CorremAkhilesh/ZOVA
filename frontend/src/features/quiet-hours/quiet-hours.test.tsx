import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DEFAULT_QUIET_HOURS, type QuietHours } from '@zuvo/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from '@/test/axe';
import { chatFixture, personFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { lastSocket } from '@/test/socket-mock';
import { QUIET_HOURS_KEY } from './api';
import { isQuietNow, QUIET_TICK_MS, shouldAlert, useQuiet } from './quiet';

const SLOW = { timeout: 15_000 };
/** Chat ids are ObjectIds, and the quiet-hours schema checks them. */
const ASHA = '64b7f0c2a1b2c3d4e5f60001';
const TEAM = '64b7f0c2a1b2c3d4e5f60002';
vi.setConfig({ testTimeout: 30_000 });

function serveQuietHours(initial: Partial<QuietHours> = {}) {
  const state = { saved: { ...DEFAULT_QUIET_HOURS, ...initial }, puts: [] as unknown[] };
  server.use(
    http.get('*/v1/me/quiet-hours', () => HttpResponse.json({ quietHours: state.saved })),
    http.put('*/v1/me/quiet-hours', async ({ request }) => {
      const body = (await request.json()) as QuietHours;
      state.puts.push(body);
      state.saved = body;
      return HttpResponse.json({ quietHours: body });
    }),
  );
  return state;
}

async function openEditor() {
  const result = await renderApp('/settings/notifications');
  await screen.findByRole('group', { name: 'Quiet hours' }, SLOW);
  return result;
}

const save = () => userEvent.setup().click(screen.getByRole('button', { name: 'Save' }));
const setTime = (name: string, value: string) =>
  fireEvent.change(screen.getByLabelText(name), { target: { value } });

describe('Settings → Notifications: quiet hours', () => {
  it('shows a loading state, then the form (off); no axe violations', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get('*/v1/me/quiet-hours', async () => {
        await gate;
        return HttpResponse.json({ quietHours: DEFAULT_QUIET_HOURS });
      }),
    );
    const { container } = await renderApp('/settings/notifications');
    expect(await screen.findByLabelText('Loading', {}, SLOW)).toHaveAttribute('aria-busy', 'true');
    release();
    expect(await screen.findByRole('radio', { name: 'Off' }, SLOW)).toBeChecked();
    expect(screen.queryByLabelText('From')).toBeNull();
    expect(screen.getByRole('switch', { name: /Allow mentions/ })).toBeChecked();
    expect(screen.getByText('No chats found.')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows an error when quiet hours cannot load', async () => {
    server.use(http.get('*/v1/me/quiet-hours', () => HttpResponse.json({}, { status: 500 })));
    await renderApp('/settings/notifications');
    expect(await screen.findByRole('alert', {}, SLOW)).toHaveTextContent(
      'Couldn’t load your quiet hours.',
    );
  });

  it('refuses equal times and no days', async () => {
    const api = serveQuietHours();
    const user = userEvent.setup();
    const { container } = await openEditor();
    await user.click(screen.getByRole('radio', { name: 'Scheduled' }));
    setTime('From', '08:00');
    await save();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The start and end times must be different.',
    );
    setTime('Until', '09:00');
    await user.click(screen.getByRole('button', { name: 'Weekends' }));
    await user.click(screen.getByRole('button', { name: 'Sunday' }));
    await user.click(screen.getByRole('button', { name: 'Saturday' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Pick at least one day.');
    expect(await axe(container)).toHaveNoViolations();
    expect(api.puts).toEqual([]);
  });

  it('saves a schedule, a time zone and the exceptions', async () => {
    const api = serveQuietHours();
    await seedLocal([
      chatFixture({ id: ASHA, seq: 1, lastActivityAt: new Date().toISOString() }),
      chatFixture({
        id: 'c-rahul',
        seq: 1,
        otherUser: personFixture({ id: 'u-rahul', displayName: 'Rahul Menon' }),
      }),
    ]);
    const user = userEvent.setup();
    await openEditor();
    await user.click(screen.getByRole('radio', { name: 'Scheduled' }));
    setTime('From', '21:30');
    setTime('Until', '07:00');
    await user.click(screen.getByRole('button', { name: 'Weekdays' }));
    expect(screen.getByRole('button', { name: 'Weekdays' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.selectOptions(screen.getByRole('combobox', { name: 'Time zone' }), 'Asia/Tokyo');
    await user.click(screen.getByRole('switch', { name: /Allow mentions/ }));
    const chats = screen.getByRole('group', { name: 'Allow these chats' });
    await user.click(await within(chats).findByRole('checkbox', { name: /Asha Verma/ }, SLOW));
    expect(within(chats).getByText(/1 picked/)).toBeInTheDocument();
    await save();
    await waitFor(() =>
      expect(api.puts).toEqual([
        {
          mode: 'scheduled',
          start: '21:30',
          end: '07:00',
          days: [1, 2, 3, 4, 5],
          timezone: 'Asia/Tokyo',
          allowMentions: false,
          allowChatIds: [ASHA],
        },
      ]),
    );
    expect(await screen.findByText('Quiet hours saved')).toBeInTheDocument();
  });

  it('keeps a saved time zone, and follows a change from another device', async () => {
    serveQuietHours({ mode: 'on', timezone: 'Europe/London' });
    await openEditor();
    expect(screen.getByRole('radio', { name: 'On' })).toBeChecked();
    expect(screen.getByRole('combobox', { name: 'Time zone' })).toHaveValue('Europe/London');
    await waitFor(() => expect(lastSocket()).toBeDefined());
    act(() =>
      lastSocket().receive('quiet-hours:updated', {
        quietHours: { ...DEFAULT_QUIET_HOURS, mode: 'off', timezone: 'Europe/London' },
      }),
    );
    await waitFor(() => expect(screen.getByRole('radio', { name: 'Off' })).toBeChecked());
  });
});

describe('the quiet moon', () => {
  afterEach(() => vi.useRealTimers());

  /** Thursday 12 Nov 2026, 22:30 in India. */
  const LATE_EVENING = new Date('2026-11-12T17:00:00.000Z');
  const EVENING_SCHEDULE: Partial<QuietHours> = {
    mode: 'scheduled',
    start: '22:00',
    end: '08:00',
    timezone: 'Asia/Kolkata',
  };

  async function openChats() {
    await renderApp('/chats', { width: DESKTOP_WIDTH });
    await screen.findByRole('heading', { name: 'Chats' }, SLOW);
  }

  it('shows while a schedule is quiet, and lets mentions and allowed chats through', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(LATE_EVENING);
    serveQuietHours({ ...EVENING_SCHEDULE, allowChatIds: [TEAM] });
    await openChats();
    const moon = await screen.findByRole('link', { name: 'Quiet hours are on' }, SLOW);
    expect(moon).toHaveAttribute('href', '/settings/notifications');
    await waitFor(() => expect(isQuietNow()).toBe(true));
    expect(shouldAlert({ chatId: 'c1', mentionsMe: false })).toBe(false);
    expect(shouldAlert({ chatId: 'c1', mentionsMe: true })).toBe(true);
    expect(shouldAlert({ chatId: TEAM, mentionsMe: false })).toBe(true);
    expect(shouldAlert({ chatId: 'c1', mentionsMe: false }, new Date('2026-11-12T06:00:00Z'))).toBe(
      true,
    );
  });

  it('is asked again every minute, so a schedule starts on time', () => {
    vi.useFakeTimers({ now: new Date('2026-11-12T16:29:30.000Z') }); // 21:59:30 in India
    const client = new QueryClient();
    client.setQueryData(QUIET_HOURS_KEY, { ...DEFAULT_QUIET_HOURS, ...EVENING_SCHEDULE });
    const { result } = renderHook(() => useQuiet(), {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    });
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(QUIET_TICK_MS));
    expect(result.current).toBe(true);
  });

  it('is not shown outside the schedule, and appears when turned on elsewhere', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T08:00:00.000Z'));
    serveQuietHours(EVENING_SCHEDULE);
    await openChats();
    await waitFor(() => expect(lastSocket()).toBeDefined());
    expect(screen.queryByRole('link', { name: 'Quiet hours are on' })).toBeNull();
    act(() =>
      lastSocket().receive('quiet-hours:updated', {
        quietHours: { ...DEFAULT_QUIET_HOURS, mode: 'on' },
      }),
    );
    expect(await screen.findByRole('link', { name: 'Quiet hours are on' })).toBeInTheDocument();
  });
});
