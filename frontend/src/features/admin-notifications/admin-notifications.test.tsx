import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminPushUser } from '@zuvo/protocol';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from '@/test/axe';
import { HttpResponse, http, server, sessionFixture } from '@/test/msw';
import { DESKTOP_WIDTH, MOBILE_WIDTH, renderApp } from '@/test/render-app';
import { csvField, toCsv } from './csv';

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 15_000 };
afterEach(() => vi.restoreAllMocks());

const adminSession = () => {
  const base = sessionFixture();
  return { ...base, user: { ...base.user, role: 'admin' as const } };
};
const AT = '2026-11-19T09:00:00.000Z';
const person = (id: string, name: string, pushOn: boolean): AdminPushUser => ({
  user: { id, email: `${id}@corremadvisory.com`, displayName: name, username: id },
  devices: [
    {
      id: `s-${id}`,
      label: 'Chrome on Android',
      platform: 'android',
      installed: pushOn,
      permission: pushOn ? 'granted' : 'denied',
      pushOn,
      lastActiveAt: AT,
    },
  ],
  pushOn,
  lastSeenAt: AT,
});

function serve(pages: AdminPushUser[][]) {
  const reminded: string[][] = [];
  server.use(
    http.get('*/v1/auth/me', () => HttpResponse.json(adminSession())),
    http.get('*/v1/admin/notifications', ({ request }) => {
      const cursor = Number(new URL(request.url).searchParams.get('cursor') ?? 0);
      const next = cursor + 1 < pages.length ? String(cursor + 1) : null;
      return HttpResponse.json({ items: pages[cursor] ?? [], nextCursor: next });
    }),
    http.post('*/v1/admin/notifications/remind', async ({ request }) => {
      const body = (await request.json()) as { userIds: string[] };
      reminded.push(body.userIds);
      return HttpResponse.json({ sent: body.userIds.length });
    }),
  );
  return reminded;
}

describe('Admin → Notifications', () => {
  it('loads every page, filters to "OFF", and reminds the chosen; no axe violations', async () => {
    const reminded = serve([
      [person('asha', 'Asha Verma', true)],
      [person('ravi', 'Ravi Shah', false), person('meera', 'Meera Nair', false)],
    ]);
    const { container } = await renderApp('/admin/notifications', {
      width: DESKTOP_WIDTH,
    });
    const list = await screen.findByRole('list', { name: 'People and their devices' }, SLOW);
    await within(list).findByText('Meera Nair', {}, SLOW);
    expect(screen.getByText('3 people · 2 without notifications')).toBeInTheDocument();
    expect(within(list).getAllByText('Android').length).toBe(3);
    expect(await axe(container)).toHaveNoViolations();

    const user = userEvent.setup();
    await user.click(screen.getByRole('switch', { name: /Notifications OFF only/ }));
    await waitFor(() => expect(within(list).queryByText('Asha Verma')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Select all shown' }));
    await user.click(screen.getByRole('button', { name: 'Remind (2)' }));
    await waitFor(() => expect(reminded).toEqual([['ravi', 'meera']]));
    expect(await screen.findByText('Reminder sent to 2 people.')).toBeInTheDocument();
  });

  it('on a phone too, and says so when everyone is on', async () => {
    serve([[person('asha', 'Asha Verma', true)]]);
    await renderApp('/admin/notifications', { width: MOBILE_WIDTH });
    await screen.findByText('Asha Verma', {}, SLOW);
    await userEvent.setup().click(screen.getByRole('switch', { name: /Notifications OFF only/ }));
    expect(await screen.findByText('Everyone has notifications on.')).toBeInTheDocument();
  });

  it('shows an error when the list cannot load', async () => {
    server.use(
      http.get('*/v1/auth/me', () => HttpResponse.json(adminSession())),
      http.get('*/v1/admin/notifications', () => HttpResponse.json({}, { status: 500 })),
    );
    await renderApp('/admin/notifications', { width: DESKTOP_WIDTH });
    expect(await screen.findByRole('alert', {}, SLOW)).toBeInTheDocument();
  });
});

describe('CSV export', () => {
  const labels = {
    header: [
      'Name',
      'Email',
      'Username',
      'Notifications',
      'Devices',
      'Device details',
      'Last seen',
    ],
    on: 'ON',
    off: 'OFF',
    app: 'Installed app',
    browser: 'Browser',
    unknown: 'Not reported',
  };
  it('one row per person, quoted where needed, formulas defused', () => {
    const csv = toCsv([person('ravi', 'Shah, Ravi', false)], labels);
    const lines = csv.replace('﻿', '').trim().split('\r\n');
    expect(lines[0]).toBe('Name,Email,Username,Notifications,Devices,Device details,Last seen');
    expect(lines[1]).toBe(
      `"Shah, Ravi",ravi@corremadvisory.com,ravi,OFF,1,"Chrome on Android (Browser, OFF)",${AT}`,
    );
    expect(csvField('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvField('say "hi"')).toBe('"say ""hi"""');
  });
});
