import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MESSAGE_TEXT_MAX } from '@zuvo/protocol';
import { describe, expect, it, vi } from 'vitest';
import { getUserDb } from '@/features/sync/local-db';
import { useSyncStore } from '@/features/sync/store';
import { axe } from '@/test/axe';
import { chatFixture, ME_ID, savedChatFixture } from '@/test/chat-fixtures';
import { DESKTOP_WIDTH, MOBILE_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { lastSocket } from '@/test/socket-mock';

const field = () => screen.findByRole('textbox', { name: 'Write a message' });

async function open(width = DESKTOP_WIDTH, path = '/chats/c1') {
  await seedLocal([chatFixture()]);
  const result = await renderApp(path, { width });
  const input = await field();
  await waitFor(() => expect(useSyncStore.getState().client).not.toBeNull());
  act(() => lastSocket().receive('connect'));
  return { ...result, input };
}

const sends = () =>
  lastSocket()
    .emitted.filter((entry) => entry.event === 'message:send')
    .map((entry) => (entry.payload as { text: string }).text);

describe('sending', () => {
  it('Enter sends on desktop, shows the message and clears the box', async () => {
    const user = userEvent.setup();
    const { input, container } = await open();
    input.focus();
    await user.keyboard('Hello there{Enter}');
    expect(await screen.findByText('Hello there')).toBeInTheDocument();
    await waitFor(() => expect(sends()).toEqual(['Hello there']));
    expect(input).toHaveValue('');
    expect(input).toHaveFocus();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('Shift+Enter makes a new line on desktop', async () => {
    const user = userEvent.setup();
    const { input } = await open();
    input.focus();
    await user.keyboard('one{Shift>}{Enter}{/Shift}two');
    expect(input).toHaveValue('one\ntwo');
    expect(sends()).toEqual([]);
  });

  it('Enter makes a new line on mobile, and the button sends', async () => {
    const user = userEvent.setup();
    const { input } = await open(MOBILE_WIDTH);
    await user.type(input, 'one{Enter}two');
    expect(input).toHaveValue('one\ntwo');
    expect(sends()).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(sends()).toEqual(['one\ntwo']));
  });

  it('Enter confirming a word in an input method does not send', async () => {
    const { input } = await open();
    fireEvent.change(input, { target: { value: 'नमस्ते' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(input).toHaveValue('नमस्ते');
    expect(sends()).toEqual([]);
  });

  it('does not send only spaces', async () => {
    const user = userEvent.setup();
    const { input } = await open();
    input.focus();
    await user.keyboard('   {Enter}');
    expect(sends()).toEqual([]);
  });

  it('works offline: the message waits with a clock', async () => {
    const user = userEvent.setup();
    const { input } = await open();
    act(() => lastSocket().receive('disconnect', 'transport close'));
    input.focus();
    await user.keyboard('later{Enter}');
    expect(await screen.findByText('later')).toBeInTheDocument();
    const thread = await screen.findByRole('list', { name: 'Asha Verma' });
    expect(await within(thread).findByRole('img', { name: 'Sending' })).toBeInTheDocument();
    expect(sends()).toEqual([]);

    act(() => lastSocket().receive('connect'));
    await waitFor(() => expect(sends()).toEqual(['later']));
    expect(await within(thread).findByRole('img', { name: 'Sent' })).toBeInTheDocument();
  });

  it('Saved Messages works like any other chat', async () => {
    const user = userEvent.setup();
    await seedLocal([]);
    await renderApp(`/chats/${savedChatFixture().id}`, { width: DESKTOP_WIDTH });
    const input = await field();
    await waitFor(() => expect(useSyncStore.getState().client).not.toBeNull());
    act(() => lastSocket().receive('connect'));
    expect(await screen.findByText(/Only you can see them/)).toBeInTheDocument();
    input.focus();
    await user.keyboard('a note{Enter}');
    const thread = await screen.findByRole('list', { name: 'Saved Messages' });
    expect(await within(thread).findByText('a note')).toBeInTheDocument();
    await waitFor(() => expect(sends()).toEqual(['a note']));
  });
});

describe('limits', () => {
  it('shows no counter far from the limit', async () => {
    const { input } = await open();
    fireEvent.change(input, { target: { value: 'x'.repeat(100) } });
    expect(screen.queryByText(/characters left/)).not.toBeInTheDocument();
  });

  it('shows a counter near the limit, and refuses to send over it', async () => {
    const { input } = await open();
    fireEvent.change(input, { target: { value: 'x'.repeat(MESSAGE_TEXT_MAX - 10) } });
    expect(screen.getByText('10 characters left')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();

    fireEvent.change(input, { target: { value: 'x'.repeat(MESSAGE_TEXT_MAX + 1) } });
    expect(screen.getByText('1 character over the limit')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(sends()).toEqual([]);
  });
});

describe('drafts', () => {
  it('keeps a draft per chat', async () => {
    const user = userEvent.setup();
    const { input } = await open();
    input.focus();
    await user.keyboard('half a thought');
    const db = getUserDb(ME_ID);
    await waitFor(async () =>
      expect((await db.chats.get('c1'))?.draft).toMatchObject({ text: 'half a thought' }),
    );
  });

  it('restores the draft on opening the chat, and empties it on sending', async () => {
    // Saved by an older version, in the table drafts used to have: moved onto the chat's row.
    const db = await seedLocal([chatFixture()]);
    await db.drafts.put({ chatId: 'c1', text: 'come back to this' });
    const user = userEvent.setup();
    await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    const input = await field();
    await waitFor(() => expect(input).toHaveValue('come back to this'));
    await waitFor(() => expect(useSyncStore.getState().client).not.toBeNull());
    input.focus();
    await user.keyboard('{Enter}');
    await waitFor(async () => expect((await db.chats.get('c1'))?.draft?.text).toBe(''));
    expect(await db.drafts.get('c1')).toBeUndefined();
    expect(input).toHaveValue('');
  });
});

describe('buttons', () => {
  it('offers the mic while the box is empty, and Send once there is text', async () => {
    const user = userEvent.setup();
    const { input } = await open();
    expect(screen.getByRole('button', { name: 'Record a voice note' })).toBeEnabled();
    input.focus();
    await user.keyboard('hi');
    expect(screen.queryByRole('button', { name: 'Record a voice note' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('explains the microphone before the browser asks', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByRole('button', { name: 'Record a voice note' }));
    expect(await screen.findByRole('dialog', { name: 'Use your microphone?' })).toBeInTheDocument();
  });

  it('says how to unblock a microphone the browser has blocked', async () => {
    const user = userEvent.setup();
    const query = vi.fn(async () => ({ state: 'denied' }));
    Object.defineProperty(navigator, 'permissions', { value: { query }, configurable: true });
    await open();
    await user.click(screen.getByRole('button', { name: 'Record a voice note' }));
    expect(await screen.findByRole('dialog', { name: 'Microphone blocked' })).toBeInTheDocument();
    Reflect.deleteProperty(navigator, 'permissions');
  });

  it('swaps the voice button for send while typing', async () => {
    const user = userEvent.setup();
    const { input } = await open();
    input.focus();
    await user.keyboard('Hi');
    expect(await screen.findByRole('button', { name: 'Send' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record a voice note' })).not.toBeInTheDocument();
  });

  it('inserts an emoji from the picker', async () => {
    const user = userEvent.setup();
    const { input } = await open();
    input.focus();
    await user.keyboard('Nice ');
    await user.click(screen.getByRole('button', { name: 'Emoji' }));
    const tab = await screen.findByRole('tab', { name: 'Gestures and symbols' });
    await user.click(tab);
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(await axe(document.body)).toHaveNoViolations();
    await user.click(screen.getByRole('button', { name: '👍' }));
    expect(input).toHaveValue('Nice 👍');
    await waitFor(() =>
      expect(screen.queryByRole('tab', { name: 'Smileys' })).not.toBeInTheDocument(),
    );
  });
});
