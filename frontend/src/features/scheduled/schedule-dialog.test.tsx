import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from '@/test/axe';
import ScheduleDialog from './components/ScheduleDialog';
import { SendButton } from './components/SendButton';
import { fixZone, refuse, renderAlone, serveScheduled } from './test-server';

vi.setConfig({ testTimeout: 30_000 });

// Thursday 12 November 2026, 10:00 in India.
const NOW = new Date('2026-11-12T04:30:00.000Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  fixZone('Asia/Kolkata');
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function openDialog(draft = { text: 'Standup notes' }) {
  const onDone = vi.fn();
  const onClose = vi.fn();
  const result = renderAlone(
    <ScheduleDialog mode="create" chatId="c1" draft={draft} onDone={onDone} onClose={onClose} />,
  );
  return {
    ...result,
    onDone,
    onClose,
    dialog: screen.getByRole('dialog', { name: 'Schedule message' }),
  };
}

const sentBody = (state: ReturnType<typeof serveScheduled>) =>
  state.requests.find((request) => request.method === 'POST')?.body;

describe('schedule dialog', () => {
  it('"Tomorrow 9 AM" schedules 9:00 tomorrow in my time zone', async () => {
    const state = serveScheduled([]);
    const user = userEvent.setup();
    const { dialog, onDone, onClose, container } = openDialog();
    expect(dialog).toHaveTextContent('Standup notes');
    expect(dialog).toHaveTextContent('Times are in your time zone: Asia/Kolkata (GMT+5:30)');
    expect(await axe(container.ownerDocument.body)).toHaveNoViolations();
    await user.click(within(dialog).getByRole('button', { name: /Tomorrow 9 AM/ }));
    expect(within(dialog).getByLabelText('Date')).toHaveValue('2026-11-13');
    expect(within(dialog).getByLabelText('Time')).toHaveValue('09:00');
    await user.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sentBody(state)).toEqual({
      chatId: 'c1',
      text: 'Standup notes',
      sendAt: '2026-11-13T03:30:00.000Z',
    });
    expect(onClose).toHaveBeenCalled();
    expect(await screen.findByText(/Scheduled for/)).toBeInTheDocument();
  });

  it('"Monday 9 AM" is next Monday, and mentions travel with the message', async () => {
    const state = serveScheduled([]);
    const user = userEvent.setup();
    const mentions = [{ userId: 'u-asha', offset: 0, length: 5 }];
    const { dialog, onDone } = openDialog({
      text: '@Asha hi',
      mentions,
      mentionsEveryone: true,
    } as never);
    await user.click(within(dialog).getByRole('button', { name: /Monday 9 AM/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sentBody(state)).toEqual({
      chatId: 'c1',
      text: '@Asha hi',
      sendAt: '2026-11-16T03:30:00.000Z',
      mentions,
      mentionsEveryone: true,
    });
  });

  it('a date and time of my own', async () => {
    const state = serveScheduled([]);
    const user = userEvent.setup();
    const { dialog, onDone } = openDialog();
    fireEvent.change(within(dialog).getByLabelText('Date'), { target: { value: '2026-12-25' } });
    fireEvent.change(within(dialog).getByLabelText('Time'), { target: { value: '18:45' } });
    await user.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(sentBody(state)).toMatchObject({ sendAt: '2026-12-25T13:15:00.000Z' });
  });

  it('says why a time can’t be used: past, too soon, too far ahead', async () => {
    const state = serveScheduled([]);
    const user = userEvent.setup();
    const { dialog } = openDialog();
    const date = within(dialog).getByLabelText('Date');
    const time = within(dialog).getByLabelText('Time');
    const schedule = within(dialog).getByRole('button', { name: 'Schedule' });

    fireEvent.change(date, { target: { value: '2026-11-11' } });
    await user.click(schedule);
    expect(within(dialog).getByRole('alert')).toHaveTextContent('That time has already passed.');
    expect(date).toHaveAttribute('aria-invalid', 'true');

    vi.setSystemTime(new Date('2026-11-12T04:29:30.000Z'));
    fireEvent.change(date, { target: { value: '2026-11-12' } });
    fireEvent.change(time, { target: { value: '10:00' } });
    await user.click(schedule);
    expect(within(dialog).getByRole('alert')).toHaveTextContent('at least a minute from now');

    fireEvent.change(date, { target: { value: '2028-01-01' } });
    await user.click(schedule);
    expect(within(dialog).getByRole('alert')).toHaveTextContent('up to a year ahead');

    fireEvent.change(time, { target: { value: '' } });
    await user.click(schedule);
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Pick a date and a time.');
    expect(state.requests).toEqual([]);
  });

  it('at the limit of 50, says so in words', async () => {
    serveScheduled([]);
    refuse('post', '*/v1/me/scheduled', 409, 'SCHEDULED_LIMIT_REACHED');
    const user = userEvent.setup();
    const { dialog, onDone } = openDialog();
    await user.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'You already have 50 scheduled messages. Send or delete one first.',
    );
    expect(onDone).not.toHaveBeenCalled();
  });

  it('labels the time zone as India’s when the browser can’t say', () => {
    vi.restoreAllMocks();
    fixZone('');
    serveScheduled([]);
    const { dialog } = openDialog();
    expect(dialog).toHaveTextContent('Asia/Kolkata (GMT+5:30)');
  });
});

describe('the Send button', () => {
  function renderButton(draft: { text: string } | null) {
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    const onScheduled = vi.fn();
    renderAlone(
      <form onSubmit={onSubmit}>
        <SendButton
          chatId="c1"
          disabled={false}
          takeDraft={() => draft}
          onScheduled={onScheduled}
        />
      </form>,
    );
    return { onSubmit, onScheduled, button: screen.getByRole('button', { name: 'Send' }) };
  }

  it('right click offers "Schedule message", which opens the dialog without sending', async () => {
    serveScheduled([]);
    const user = userEvent.setup();
    const { button, onSubmit, onScheduled } = renderButton({ text: 'later' });
    fireEvent.contextMenu(button);
    await user.click(await screen.findByRole('button', { name: 'Schedule message' }));
    const dialog = await screen.findByRole('dialog', { name: 'Schedule message' });
    expect(dialog).toHaveTextContent('later');
    await user.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    await waitFor(() => expect(onScheduled).toHaveBeenCalled());
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a long press on a touch screen does the same, and the tap that ends it doesn’t send', async () => {
    vi.useRealTimers();
    const { button, onSubmit } = renderButton({ text: 'later' });
    fireEvent.touchStart(button, { touches: [{ clientX: 1, clientY: 1 }] });
    expect(
      await screen.findByRole('button', { name: 'Schedule message' }, { timeout: 2000 }),
    ).toBeVisible();
    fireEvent.touchEnd(button);
    fireEvent.click(button);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('offers nothing while editing a message', () => {
    const { button } = renderButton(null);
    fireEvent.contextMenu(button);
    expect(screen.queryByRole('button', { name: 'Schedule message' })).toBeNull();
  });
});
