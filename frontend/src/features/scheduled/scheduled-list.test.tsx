import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAccountChange } from '@/features/settings/chat-settings';
import { axe } from '@/test/axe';
import { HttpResponse, http, server } from '@/test/msw';
import { ScheduledButton } from './components/ScheduledButton';
import ScheduledSheet from './components/ScheduledSheet';
import { fixZone, refuse, renderAlone, scheduledFixture, serveScheduled } from './test-server';

vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-12T04:30:00.000Z'));
  fixZone('Asia/Kolkata');
});
afterEach(() => {
  toast.dismiss();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const waiting = scheduledFixture({ id: 's1', text: 'Happy birthday!' });
const failed = scheduledFixture({
  id: 's2',
  text: 'Report attached',
  sendAt: '2026-11-11T03:30:00.000Z',
  status: 'failed',
  failure: 'admins_only',
});
const elsewhere = scheduledFixture({ id: 's3', chatId: 'c2', text: 'Other chat' });

function openSheet() {
  const onClose = vi.fn();
  const result = renderAlone(<ScheduledSheet chatId="c1" onClose={onClose} />);
  return { ...result, onClose };
}

describe('scheduled messages list', () => {
  it('loading, then this chat’s messages with their time, and failed ones with the reason', async () => {
    serveScheduled([waiting, failed, elsewhere]);
    const { container } = openSheet();
    const dialog = screen.getByRole('dialog', { name: 'Scheduled messages' });
    expect(dialog).toHaveTextContent('Loading');
    const list = await within(dialog).findByRole('list', { name: 'Scheduled messages' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Happy birthday!');
    expect(rows[0]).toHaveTextContent('Nov 20, 2026, 9:00 AM');
    expect(rows[1]).toHaveTextContent('Not sent. Only admins can send messages in this group now.');
    // A failed one can't be changed any more, only sent or removed.
    expect(within(rows[1] as HTMLElement).queryByRole('button', { name: /^Edit/ })).toBeNull();
    expect(dialog).not.toHaveTextContent('Other chat');
    expect(await axe(container.ownerDocument.body)).toHaveNoViolations();
  });

  it('empty', async () => {
    serveScheduled([elsewhere]);
    openSheet();
    expect(await screen.findByText('No scheduled messages in this chat.')).toBeInTheDocument();
  });

  it('error, and trying again', async () => {
    server.use(
      http.get('*/v1/me/scheduled', () =>
        HttpResponse.json(
          { code: 'INTERNAL_ERROR', message: 'x', requestId: 'r' },
          { status: 500 },
        ),
      ),
    );
    openSheet();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Couldn’t load your scheduled messages.');
    serveScheduled([waiting]);
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Happy birthday!')).toBeInTheDocument();
  });

  it('edits the text and time', async () => {
    const state = serveScheduled([waiting]);
    const user = userEvent.setup();
    openSheet();
    await user.click(
      await screen.findByRole('button', {
        name: 'Edit the message scheduled for Nov 20, 2026, 9:00 AM',
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: 'Edit scheduled message' });
    const text = within(dialog).getByLabelText('Message');
    expect(text).toHaveValue('Happy birthday!');
    fireEvent.change(text, { target: { value: 'Happy birthday, Asha!' } });
    fireEvent.change(within(dialog).getByLabelText('Time'), { target: { value: '08:15' } });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(state.requests).toHaveLength(1));
    expect(state.requests[0]).toEqual({
      method: 'PATCH',
      path: '/v1/me/scheduled/s1',
      body: { text: 'Happy birthday, Asha!', sendAt: '2026-11-20T02:45:00.000Z' },
    });
    expect(await screen.findByText('Happy birthday, Asha!')).toBeInTheDocument();
  });

  it('an edit that came too late says the message is no longer waiting', async () => {
    serveScheduled([waiting]);
    refuse('patch', '*/v1/me/scheduled/:id', 409, 'CONFLICT');
    const user = userEvent.setup();
    openSheet();
    await user.click(await screen.findByRole('button', { name: /^Edit the message/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit scheduled message' });
    fireEvent.change(within(dialog).getByLabelText('Message'), { target: { value: 'changed' } });
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('no longer waiting');
  });

  it('sends one now', async () => {
    const state = serveScheduled([waiting, failed]);
    const user = userEvent.setup();
    openSheet();
    await user.click(
      await screen.findByRole('button', { name: /^Send now: the message scheduled for Nov 11/ }),
    );
    await waitFor(() =>
      expect(state.requests).toEqual([
        { method: 'POST', path: '/v1/me/scheduled/s2/send-now', body: null },
      ]),
    );
    await waitFor(() => expect(screen.queryByText('Report attached')).toBeNull());
    expect(await screen.findByText('Sent')).toBeInTheDocument();
  });

  it('deletes one after asking', async () => {
    const state = serveScheduled([waiting]);
    const user = userEvent.setup();
    openSheet();
    await user.click(await screen.findByRole('button', { name: /^Delete the message/ }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete this scheduled message?' });
    expect(state.requests).toEqual([]);
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(state.requests).toEqual([
        { method: 'DELETE', path: '/v1/me/scheduled/s1', body: null },
      ]),
    );
    expect(await screen.findByText('No scheduled messages in this chat.')).toBeInTheDocument();
  });
});

describe('the header clock', () => {
  it('shows only while this chat has scheduled messages, with the count in its name', async () => {
    serveScheduled([waiting, failed, elsewhere]);
    const user = userEvent.setup();
    const { container } = renderAlone(<ScheduledButton chatId="c1" />);
    const button = await screen.findByRole('button', { name: '2 scheduled messages' });
    expect(await axe(container)).toHaveNoViolations();
    await user.click(button);
    expect(await screen.findByRole('dialog', { name: 'Scheduled messages' })).toBeInTheDocument();
  });

  it('is not there when nothing is scheduled', async () => {
    const state = serveScheduled([elsewhere]);
    renderAlone(<ScheduledButton chatId="c1" />);
    await waitFor(() => expect(state.items).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole('button', { name: /scheduled message/ })).toBeNull();
  });
});

describe('scheduled:updated', () => {
  it('refetches, and says when one could not be sent and why', async () => {
    const state = serveScheduled([waiting]);
    const { queryClient } = renderAlone(<ScheduledButton chatId="c1" />);
    await screen.findByRole('button', { name: '1 scheduled message' });
    state.items = [waiting, scheduledFixture({ id: 's9' })];
    applyAccountChange(queryClient, {
      kind: 'scheduled',
      chatId: 'c1',
      failed: { id: 's1', reason: 'blocked' },
    });
    expect(await screen.findByText('A scheduled message couldn’t be sent')).toBeInTheDocument();
    expect(screen.getByText('One of you has blocked the other.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: '2 scheduled messages' })).toBeInTheDocument();
  });

  it('a change without a failure only refetches', async () => {
    const state = serveScheduled([waiting]);
    const { queryClient } = renderAlone(<ScheduledButton chatId="c1" />);
    await screen.findByRole('button', { name: '1 scheduled message' });
    state.items = [];
    applyAccountChange(queryClient, { kind: 'scheduled', chatId: 'c1', failed: null });
    await waitFor(() => expect(screen.queryByRole('button', { name: /scheduled/ })).toBeNull());
    expect(screen.queryByText(/couldn’t be sent/)).toBeNull();
  });
});
