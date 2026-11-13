import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useSyncStore } from '@/features/sync/store';
import { axe } from '@/test/axe';
import { chatFixture } from '@/test/chat-fixtures';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { lastSocket } from '@/test/socket-mock';
import CreatePollDialog from './components/CreatePollDialog';

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 15_000 };

function openCreator() {
  const onSend = vi.fn();
  const onClose = vi.fn();
  render(<CreatePollDialog onSend={onSend} onClose={onClose} />);
  const dialog = screen.getByRole('dialog', { name: 'Create poll' });
  const send = () => within(dialog).getByRole('button', { name: 'Send poll' });
  const optionField = (n: number) => within(dialog).getByRole('textbox', { name: `Option ${n}` });
  return { dialog, onSend, onClose, send, optionField };
}

describe('poll creator', () => {
  it('question, options with Enter moving on, and "Allow multiple answers"', async () => {
    const user = userEvent.setup();
    const { dialog, onSend, send, optionField } = openCreator();
    expect(await axe(dialog)).toHaveNoViolations();
    within(dialog).getByLabelText('Question').focus();
    await user.keyboard('Lunch?');
    optionField(1).focus();
    await user.keyboard('Pizza{Enter}');
    expect(optionField(2)).toHaveFocus();
    await user.keyboard('Dosa{Enter}');
    // Enter in the last option adds the next one.
    await waitFor(() => expect(optionField(3)).toHaveFocus());
    await user.keyboard('Salad');
    await user.click(within(dialog).getByRole('switch', { name: /Allow multiple answers/ }));
    await user.click(send());
    expect(onSend).toHaveBeenCalledWith({
      question: 'Lunch?',
      options: ['Pizza', 'Dosa', 'Salad'],
      multiple: true,
    });
  });

  it('adds and removes options, from 2 up to 12', async () => {
    const user = userEvent.setup();
    const { dialog } = openCreator();
    // Two is the least: nothing to remove yet.
    expect(within(dialog).queryByRole('button', { name: /^Remove option/ })).toBeNull();
    const add = within(dialog).getByRole('button', { name: 'Add option' });
    for (let count = 2; count < 12; count += 1) await user.click(add);
    expect(within(dialog).getAllByRole('textbox', { name: /^Option/ })).toHaveLength(12);
    expect(add).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Remove option 12' }));
    expect(within(dialog).getAllByRole('textbox', { name: /^Option/ })).toHaveLength(11);
    expect(add).toBeEnabled();
  });

  it('says what is wrong: no question, too few options, the same option twice', async () => {
    const user = userEvent.setup();
    const { dialog, onSend, send, optionField } = openCreator();
    await user.click(send());
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Write a question.');
    expect(within(dialog).getByLabelText('Question')).toHaveAttribute('aria-invalid', 'true');

    within(dialog).getByLabelText('Question').focus();
    await user.keyboard('Lunch?');
    optionField(1).focus();
    await user.keyboard('Pizza');
    await user.click(send());
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Add at least 2 options.');

    optionField(2).focus();
    await user.keyboard(' PIZZA ');
    await user.click(send());
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Option 2 is the same as another one.',
    );
    expect(optionField(2)).toHaveAttribute('aria-invalid', 'true');
    expect(optionField(1)).toHaveAttribute('aria-invalid', 'false');
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe('sending a poll', () => {
  async function openChat(chatId: string) {
    await seedLocal([chatFixture()]);
    await renderApp(`/chats/${chatId}`, { width: DESKTOP_WIDTH });
    await screen.findByRole('textbox', { name: 'Write a message' }, SLOW);
    await waitFor(() => expect(useSyncStore.getState().client).not.toBeNull());
    act(() => lastSocket().receive('connect'));
  }

  it('from the attach menu: sent through the outbox as message:send with the poll', async () => {
    const user = userEvent.setup();
    await openChat('c1');
    await user.click(screen.getByRole('button', { name: 'Attach a file' }));
    await user.click(await screen.findByRole('button', { name: 'Poll' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create poll' });
    within(dialog).getByLabelText('Question').focus();
    await user.keyboard('Team lunch?');
    within(dialog).getByRole('textbox', { name: 'Option 1' }).focus();
    await user.keyboard('Friday{Enter}Monday');
    await user.click(within(dialog).getByRole('button', { name: 'Send poll' }));

    expect(await screen.findByRole('group', { name: 'Team lunch?' })).toBeInTheDocument();
    await waitFor(() =>
      expect(lastSocket().emitted.filter((entry) => entry.event === 'message:send')).toHaveLength(
        1,
      ),
    );
    const sent = lastSocket().emitted.find((entry) => entry.event === 'message:send');
    expect(sent?.payload).toEqual({
      chatId: 'c1',
      clientMsgId: expect.any(String),
      poll: { question: 'Team lunch?', options: ['Friday', 'Monday'], multiple: false },
    });
    // Moved up the chat list with the poll's preview.
    expect(await screen.findByText('You: 📊 Poll: Team lunch?')).toBeInTheDocument();
  });

  it('made offline, it waits in the outbox and goes once connected', async () => {
    const user = userEvent.setup();
    await seedLocal([chatFixture()]);
    await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    await screen.findByRole('textbox', { name: 'Write a message' }, SLOW);
    await waitFor(() => expect(useSyncStore.getState().client).not.toBeNull());
    await user.click(screen.getByRole('button', { name: 'Attach a file' }));
    await user.click(await screen.findByRole('button', { name: 'Poll' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create poll' });
    within(dialog).getByLabelText('Question').focus();
    await user.keyboard('Later?');
    within(dialog).getByRole('textbox', { name: 'Option 1' }).focus();
    await user.keyboard('Yes{Enter}No');
    await user.click(within(dialog).getByRole('button', { name: 'Send poll' }));
    expect(await screen.findByRole('group', { name: 'Later?' })).toBeInTheDocument();
    const sends = () => lastSocket().emitted.filter((entry) => entry.event === 'message:send');
    expect(sends()).toHaveLength(0);
    act(() => lastSocket().receive('connect'));
    await waitFor(() => expect(sends()).toHaveLength(1));
    expect(sends()[0]?.payload).toMatchObject({
      poll: { question: 'Later?', options: ['Yes', 'No'] },
    });
  });

  it('is not offered in Saved Messages', async () => {
    const user = userEvent.setup();
    await openChat('c-saved');
    await user.click(screen.getByRole('button', { name: 'Attach a file' }));
    await screen.findByRole('button', { name: 'Document' });
    expect(screen.queryByRole('button', { name: 'Poll' })).toBeNull();
  });
});
