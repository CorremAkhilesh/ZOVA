import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { axe } from '@/test/axe';
import { chatFixture, ME_ID, messageFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { useMessageUi } from './store';

const SLOW = { timeout: 15_000 };
const OTHER = 'u-riya';
let requests: Array<{ method: string; path: string; body: unknown }>;

beforeEach(() => {
  requests = [];
  useMessageUi.setState({
    replies: {},
    editing: null,
    selecting: null,
    selected: [],
    menu: null,
    chatMenu: null,
    forwarding: null,
    deleting: null,
    whoReacted: null,
    jump: null,
  });
  const record = async ({ request }: { request: Request }) => {
    const url = new URL(request.url);
    const text = await request.text();
    requests.push({
      method: request.method,
      path: `${url.pathname}${url.search}`,
      body: text ? JSON.parse(text) : null,
    });
    return HttpResponse.json({ ok: true, sent: 1 });
  };
  server.use(
    http.patch('*/v1/chats/:id/messages/:mid', record),
    http.delete('*/v1/chats/:id/messages/:mid', record),
    http.put('*/v1/chats/:id/messages/:mid/*', record),
    http.delete('*/v1/chats/:id/messages/:mid/*', record),
    http.post('*/v1/forward', record),
  );
});

const mine = (seq: number, text: string, extra: object = {}) =>
  messageFixture(seq, {
    id: `m${seq}`,
    senderId: ME_ID,
    text,
    createdAt: new Date(Date.now() - (100 - seq) * 1000).toISOString(),
    ...extra,
  });
const theirs = (seq: number, text: string, extra: object = {}) =>
  messageFixture(seq, {
    id: `m${seq}`,
    senderId: OTHER,
    text,
    createdAt: new Date(Date.now() - (100 - seq) * 1000).toISOString(),
    ...extra,
  });

async function open(messages: ReturnType<typeof mine>[]) {
  await seedLocal([chatFixture({ seq: messages.length })], messages);
  return renderApp('/chats/c1', { width: DESKTOP_WIDTH });
}

const bubble = (text: string) => screen.findByText(text, undefined, SLOW);
async function menuOn(text: string) {
  const element = await bubble(text);
  fireEvent.contextMenu(element);
  return screen.findByRole('menu', { name: 'Message actions' });
}
const choose = async (menu: HTMLElement, name: string | RegExp) =>
  fireEvent.click(within(menu).getByRole('menuitem', { name }));

describe('the menu', () => {
  it('offers everything for my own recent message, with the reaction bar', async () => {
    const { container } = await open([mine(1, 'hello')]);
    const menu = await menuOn('hello');
    for (const name of ['Reply', 'Forward', 'Copy', 'Edit', 'Star', 'Select', 'Delete']) {
      expect(within(menu).getByRole('menuitem', { name })).toBeInTheDocument();
    }
    expect(within(menu).getByRole('menuitem', { name: '👍' })).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('does not offer edit on someone else’s message', async () => {
    await open([theirs(1, 'hi there')]);
    const menu = await menuOn('hi there');
    expect(within(menu).queryByRole('menuitem', { name: 'Edit' })).not.toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Reply' })).toBeInTheDocument();
  });
});

describe('reply', () => {
  it('shows the quote above the composer, Esc cancels, and sending carries it', async () => {
    const user = userEvent.setup();
    await open([theirs(1, 'a question')]);
    await choose(await menuOn('a question'), 'Reply');
    expect(await screen.findByText('a question', { selector: '.truncate' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(useMessageUi.getState().replies.c1).toBeUndefined());
    await choose(await menuOn('a question'), 'Reply');
    await screen.findByRole('button', { name: 'Cancel reply' });
    await user.click(screen.getByRole('button', { name: 'Cancel reply' }));
    expect(useMessageUi.getState().replies.c1).toBeUndefined();
  });

  it('R replies to the focused message', async () => {
    await open([theirs(1, 'read me')]);
    const row = (await bubble('read me')).closest('[data-seq]') as HTMLElement;
    fireEvent.keyDown(row, { key: 'r' });
    expect(await screen.findByRole('button', { name: 'Cancel reply' })).toBeInTheDocument();
  });

  it('a quote in a bubble takes you to the original and marks it', async () => {
    const quote = {
      id: 'm1',
      chatId: 'c1',
      seq: 1,
      senderId: OTHER,
      senderName: 'Riya',
      type: 'text' as const,
      text: 'the original',
      mediaId: null,
      hasThumbnail: false,
      deleted: false,
    };
    await open([theirs(1, 'the original'), mine(2, 'my answer', { replyTo: quote })]);
    const link = await screen.findByRole('button', { name: /Go to the message from Riya/ }, SLOW);
    fireEvent.click(link);
    await waitFor(() => expect(useMessageUi.getState().jump).toBeNull());
    const row = (await screen.findByText('my answer')).closest('[data-seq]');
    expect(row).toBeInTheDocument();
    const original = document.querySelector('[data-seq="1"]');
    await waitFor(() => expect(original?.className).toContain('bg-brand/25'));
  });

  it('a deleted original says so and does not pretend to be a link', async () => {
    const quote = {
      id: 'm9',
      chatId: 'c1',
      seq: 1,
      senderId: OTHER,
      senderName: 'Riya',
      type: 'text' as const,
      text: '',
      mediaId: null,
      hasThumbnail: false,
      deleted: true,
    };
    await open([mine(2, 'my answer', { replyTo: quote })]);
    expect(
      await screen.findByText('This message was deleted', undefined, SLOW),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Go to the message/ })).not.toBeInTheDocument();
  });
});

describe('edit', () => {
  it('moves the text to the composer, and saving marks it edited', async () => {
    const user = userEvent.setup();
    await open([mine(1, 'helo')]);
    await choose(await menuOn('helo'), 'Edit');
    const input = screen.getByRole('textbox', { name: 'Write a message' });
    await waitFor(() => expect(input).toHaveValue('helo'));
    input.focus();
    await user.keyboard('{End}lo{Enter}');
    await waitFor(() =>
      expect(requests).toContainEqual({
        method: 'PATCH',
        path: '/v1/chats/c1/messages/m1',
        body: { text: 'helolo' },
      }),
    );
    expect(await screen.findByText('edited')).toBeInTheDocument();
  });

  it('Up arrow edits my last message, and Esc gives back what I was writing', async () => {
    const user = userEvent.setup();
    await open([mine(1, 'earlier'), theirs(2, 'from riya')]);
    const input = await screen.findByRole('textbox', { name: 'Write a message' }, SLOW);
    input.focus();
    await user.keyboard('{ArrowUp}');
    await waitFor(() => expect(input).toHaveValue('earlier'));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(input).toHaveValue(''));
    expect(requests).toEqual([]);
  });
});

describe('delete', () => {
  it('offers both on my own message; for everyone leaves a tombstone', async () => {
    await open([mine(1, 'oops')]);
    await choose(await menuOn('oops'), 'Delete');
    const dialog = await screen.findByRole('dialog', { name: 'Delete this message?' });
    expect(within(dialog).getByRole('button', { name: 'Delete for me' })).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete for everyone' }));
    expect(await screen.findByText('This message was deleted')).toBeInTheDocument();
    await waitFor(() => expect(requests[0]?.path).toBe('/v1/chats/c1/messages/m1?scope=everyone'));
  });

  it('offers only "for me" on someone else’s message, which then goes away', async () => {
    await open([theirs(1, 'not mine'), theirs(2, 'stays')]);
    await choose(await menuOn('not mine'), 'Delete');
    const dialog = await screen.findByRole('dialog', { name: 'Delete this message?' });
    expect(
      within(dialog).queryByRole('button', { name: 'Delete for everyone' }),
    ).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete for me' }));
    await waitFor(() => expect(screen.queryByText('not mine')).not.toBeInTheDocument());
    expect(screen.getByText('stays')).toBeInTheDocument();
  });

  it('shows what an admin deleted', async () => {
    await open([
      theirs(1, '', {
        deletedForEveryoneAt: new Date().toISOString(),
        deletedByAdmin: true,
        text: null,
      }),
    ]);
    expect(
      await screen.findByText('This message was deleted by an admin', undefined, SLOW),
    ).toBeInTheDocument();
  });
});

describe('reactions', () => {
  const at = '2026-11-06T10:00:00.000Z';

  it('the bar reacts, tapping the same one again takes it back', async () => {
    await open([theirs(1, 'nice')]);
    await choose(await menuOn('nice'), '👍');
    const pill = await screen.findByRole('button', { name: /👍, 1/ });
    expect(pill).toBeInTheDocument();
    await waitFor(() =>
      expect(requests[0]).toMatchObject({ method: 'PUT', body: { emoji: '👍' } }),
    );
    await choose(await menuOn('nice'), '👍');
    await waitFor(() => expect(screen.queryByRole('button', { name: /👍, 1/ })).toBeNull());
  });

  it('the full picker opens from the bar', async () => {
    await open([theirs(1, 'nice')]);
    const menu = await menuOn('nice');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'More emoji' }));
    const grid = await screen.findByRole('menu', { name: 'Message actions' });
    expect(within(grid).queryByRole('menuitem', { name: 'Reply' })).not.toBeInTheDocument();
  });

  it('a pill shows who reacted, and lets me take mine back', async () => {
    const { container } = await open([
      theirs(1, 'nice', {
        reactions: [
          { userId: OTHER, emoji: '👍', at },
          { userId: ME_ID, emoji: '👍', at },
        ],
      }),
    ]);
    fireEvent.click(await screen.findByRole('button', { name: /👍, 2/ }, SLOW));
    const dialog = await screen.findByRole('dialog', { name: 'Reactions' });
    expect(within(dialog).getByText('You')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Tap to remove' }));
    await waitFor(() => expect(requests[0]?.method).toBe('DELETE'));
  });
});
