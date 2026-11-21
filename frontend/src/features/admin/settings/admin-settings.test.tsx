import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AdminSettingsResponse, AppSettings } from '@zuvo/protocol';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '@/test/axe';
import { HttpResponse, http, server, sessionFixture } from '@/test/msw';
import { DESKTOP_WIDTH, MOBILE_WIDTH, renderApp } from '@/test/render-app';
import { fromField, pendingOf, toField } from './settings-model';

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 15_000 };

const adminSession = () => {
  const base = sessionFixture();
  return { ...base, user: { ...base.user, role: 'admin' as const } };
};
const DEFAULTS: AppSettings = {
  mediaUserQuotaMb: 3072,
  mediaMaxFileMb: 1024,
  storageGuardPercent: 85,
  calls: 'admins',
  status: true,
  groupMaxMembers: 256,
  linkPreviews: true,
  adminChatUserCanReply: true,
  otpIpLimitPerHour: 30,
  otpFailuresPerEmailPerDay: 15,
  autoCleanupDays: null,
};
const response = (values: Partial<AppSettings> = {}): AdminSettingsResponse => ({
  values: { ...DEFAULTS, ...values },
  defaults: DEFAULTS,
  overridden: Object.keys(values) as AdminSettingsResponse['overridden'],
  updatedAt: Object.keys(values).length ? '2026-11-21T09:00:00.000Z' : null,
  updatedBy: Object.keys(values).length ? 'kiran@corremadvisory.com' : null,
});

function serve(start = response()) {
  const saved: unknown[] = [];
  server.use(
    http.get('*/v1/auth/me', () => HttpResponse.json(adminSession())),
    http.get('*/v1/admin/settings', () => HttpResponse.json(start)),
    http.put('*/v1/admin/settings', async ({ request }) => {
      const body = (await request.json()) as { changes: Partial<AppSettings> };
      saved.push(body);
      return HttpResponse.json(response(body.changes));
    }),
  );
  return saved;
}

describe('Admin → Settings', () => {
  it('shows each setting with its default; no axe violations', async () => {
    serve();
    const { container } = await renderApp('/admin/settings', { width: DESKTOP_WIDTH });
    expect(await screen.findByLabelText('Storage per person', {}, SLOW)).toHaveValue('3');
    expect(screen.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    expect(screen.getByRole('switch', { name: 'Status updates' })).toBeChecked();
    expect(screen.getByLabelText('Voice and video calls')).toHaveValue('admins');
    expect(screen.getByText(/Default: 85\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('saves changes with a reason, listing what changes', async () => {
    const user = userEvent.setup();
    const saved = serve();
    await renderApp('/admin/settings', { width: DESKTOP_WIDTH });
    const quota = await screen.findByLabelText('Storage per person', {}, SLOW);
    await user.clear(quota);
    await user.type(quota, '5');
    await user.click(screen.getByRole('switch', { name: 'Link previews' }));
    await user.selectOptions(screen.getByLabelText('Voice and video calls'), 'Everyone');
    expect(screen.getByText('3 changes not saved')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const dialog = await screen.findByRole('dialog', { name: 'Save 3 changes?' });
    expect(dialog).toHaveTextContent('Storage per person: 3 GB → 5 GB');
    expect(dialog).toHaveTextContent('Link previews: On → Off');
    await user.type(within(dialog).getByLabelText('Reason'), 'Bigger files for design');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(saved).toEqual([
        {
          changes: { mediaUserQuotaMb: 5120, calls: 'all', linkPreviews: false },
          reset: [],
          reason: 'Bigger files for design',
        },
      ]),
    );
  });

  it('marks a value out of range and will not save until it is fixed', async () => {
    const user = userEvent.setup();
    serve();
    await renderApp('/admin/settings', { width: MOBILE_WIDTH });
    const guard = await screen.findByLabelText('Stop uploads at disk', {}, SLOW);
    await user.clear(guard);
    await user.type(guard, '120');
    expect(guard).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('A whole number from 50 to 99.')).toBeInTheDocument();
    expect(screen.getByText('Fix the highlighted values first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('puts a changed setting back to its default', async () => {
    const user = userEvent.setup();
    const saved = serve(response({ groupMaxMembers: 50, autoCleanupDays: 90 }));
    await renderApp('/admin/settings', { width: DESKTOP_WIDTH });
    expect(await screen.findByLabelText('Group size', {}, SLOW)).toHaveValue('50');
    expect(screen.getByText(/Last changed .* by kiran@corremadvisory.com/)).toBeInTheDocument();
    const resets = screen.getAllByRole('button', { name: 'Reset to default' });
    expect(resets).toHaveLength(2);
    await user.click(resets[0] as HTMLElement);
    expect(screen.getByLabelText('Group size')).toHaveValue('256');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Group size: back to the default (256)');
    await user.type(within(dialog).getByLabelText('Reason'), 'Back to normal');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(saved[0]).toEqual({
        changes: {},
        reset: ['groupMaxMembers'],
        reason: 'Back to normal',
      }),
    );
  });

  it('shows an error with a retry', async () => {
    server.use(
      http.get('*/v1/auth/me', () => HttpResponse.json(adminSession())),
      http.get('*/v1/admin/settings', () =>
        HttpResponse.json(
          { code: 'INTERNAL_ERROR', message: 'x', requestId: 'r' },
          { status: 500 },
        ),
      ),
    );
    await renderApp('/admin/settings', { width: DESKTOP_WIDTH });
    const alert = await screen.findByRole('alert', {}, SLOW);
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

describe('the app follows the switches', () => {
  it('no Updates tab when status updates are off', async () => {
    server.use(
      http.get('*/v1/config', () =>
        HttpResponse.json({
          media: { maxFileBytes: 1024 ** 3, voiceMaxSeconds: 900, userQuotaBytes: 3 * 1024 ** 3 },
          features: { status: false, linkPreviews: true, groupMaxMembers: 256 },
        }),
      ),
    );
    await renderApp('/chats', { width: MOBILE_WIDTH });
    await screen.findByRole('link', { name: 'Chats' }, SLOW);
    await waitFor(() =>
      expect(screen.queryByRole('link', { name: 'Updates' })).not.toBeInTheDocument(),
    );
  });
});

describe('settings model', () => {
  it('turns stored values into form text and back', () => {
    expect(toField('mediaUserQuotaMb', 3072)).toBe('3');
    expect(toField('mediaMaxFileMb', 1536)).toBe('1.5');
    expect(toField('autoCleanupDays', null)).toBe('');
    expect(fromField('mediaUserQuotaMb', '2,5')).toBe(2560);
    expect(fromField('autoCleanupDays', '')).toBeNull();
    expect(fromField('autoCleanupDays', '10')).toBeUndefined();
    expect(fromField('storageGuardPercent', 'x')).toBeUndefined();
    expect(fromField('status', false)).toBe(false);
  });

  it('only real changes count; unchanged text and resets of saved values are told apart', () => {
    const data = response({ groupMaxMembers: 50 });
    const pending = pendingOf(
      data,
      { mediaUserQuotaMb: '3', storageGuardPercent: '200', status: false },
      new Set(['groupMaxMembers', 'linkPreviews']),
    );
    expect(pending).toEqual({
      changes: { status: false },
      reset: ['groupMaxMembers'],
      invalid: ['storageGuardPercent'],
    });
  });
});
