import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '@/test/axe';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, MOBILE_WIDTH, renderApp } from '@/test/render-app';
import { suspendUntilOf } from './SuspendPicker';
import { detail, SLOW, serve } from './test-fixtures';

vi.setConfig({ testTimeout: 30_000 });

describe('suspending', () => {
  it('suspends for 7 days with a reason; the person page shows it and can end it', async () => {
    const user = userEvent.setup();
    const { posted } = serve();
    server.use(http.get('*/v1/admin/users/meera', () => HttpResponse.json(detail())));
    await renderApp('/admin/users/meera', { width: DESKTOP_WIDTH });
    await user.click(await screen.findByRole('button', { name: 'Suspend' }, SLOW));
    const dialog = await screen.findByRole('dialog', { name: 'Suspend Meera Nair?' });
    const confirm = within(dialog).getByRole('button', { name: 'Suspend' });
    await user.type(within(dialog).getByLabelText('Reason'), 'Policy review');
    expect(confirm).toBeDisabled();
    await user.click(within(dialog).getByRole('radio', { name: '7 days' }));
    expect(await axe(dialog)).toHaveNoViolations();
    const before = Date.now();
    await user.click(confirm);
    await waitFor(() => expect(posted.at(-1)?.url).toBe('/v1/admin/users/meera/suspend'));
    const body = posted.at(-1)?.body as { until: string; reason: string };
    expect(body.reason).toBe('Policy review');
    const days = (Date.parse(body.until) - before) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);
  });

  it('shows a running suspension and ends it early', async () => {
    const user = userEvent.setup();
    const { posted } = serve();
    const until = new Date(Date.now() + 3 * 86_400_000).toISOString();
    server.use(
      http.get('*/v1/admin/users/meera', () =>
        HttpResponse.json(detail({ suspendedUntil: until, suspendReason: 'Policy review' })),
      ),
    );
    await renderApp('/admin/users/meera', { width: MOBILE_WIDTH });
    expect(
      await screen.findByText(/Suspended until .*ends on its own/, {}, SLOW),
    ).toBeInTheDocument();
    expect(screen.getByText('Reason: “Policy review”')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'End suspension' }));
    const dialog = await screen.findByRole('dialog', { name: 'End the suspension of Meera Nair?' });
    await user.type(within(dialog).getByLabelText('Reason'), 'Cleared');
    await user.click(within(dialog).getByRole('button', { name: 'End suspension' }));
    await waitFor(() =>
      expect(posted.at(-1)).toEqual({
        url: '/v1/admin/users/meera/unsuspend',
        body: { reason: 'Cleared' },
      }),
    );
  });
});

describe('suspendUntilOf', () => {
  it('1 or 7 days from now, or a date 5 minutes to a year ahead', () => {
    const now = Date.parse('2026-11-21T10:00:00Z');
    expect(suspendUntilOf({ kind: 'days', days: 1 }, now)).toBe('2026-11-22T10:00:00.000Z');
    expect(suspendUntilOf({ kind: 'days', days: 7 }, now)).toBe('2026-11-28T10:00:00.000Z');
    expect(suspendUntilOf({ kind: 'date', local: '' }, now)).toBeUndefined();
    const soon = new Date(now + 60_000);
    const local = (date: Date) =>
      new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    expect(suspendUntilOf({ kind: 'date', local: local(soon) }, now)).toBeUndefined();
    const later = new Date(now + 3 * 86_400_000);
    expect(suspendUntilOf({ kind: 'date', local: local(later) }, now)).toBe(later.toISOString());
    expect(suspendUntilOf(null, now)).toBeUndefined();
  });
});
