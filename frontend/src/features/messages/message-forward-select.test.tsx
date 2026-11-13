import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('forward', () => {
  it('picks up to 5 chats, searches, and shows the label on a copy', async () => {
    const others = ['c2', 'c3', 'c4', 'c5', 'c6', 'c7'].map((id, index) =>
      chatFixture({
        id,
        seq: 0,
        otherUser: { ...chatFixture().otherUser, id: `u${index}`, displayName: `Person ${index}` },
      } as never),
    );
    await seedLocal([chatFixture({ seq: 1 }), ...others], [theirs(1, 'share this')]);
    await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    await choose(await menuOn('share this'), 'Forward');
    const dialog = await screen.findByRole('dialog', { name: 'Forward to' });
    const list = within(dialog).getByRole('list', { name: 'Forward to' });
    await within(list).findByRole('button', { name: /Person 0/ }, SLOW);
    for (const index of [0, 1, 2, 3, 4]) {
      fireEvent.click(within(list).getByRole('button', { name: new RegExp(`Person ${index}`) }));
    }
    expect(within(dialog).getByText('5 of 5 chats chosen')).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: /Person 5/ })).toBeDisabled();
    fireEvent.change(within(dialog).getByRole('searchbox'), { target: { value: 'Person 5' } });
    expect(within(list).queryByRole('button', { name: /Person 0/ })).toBeNull();
    fireEvent.change(within(dialog).getByRole('textbox', { name: /Add a message/ }), {
      target: { value: 'look' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Forward' }));
    await waitFor(() => expect(requests[0]?.path).toBe('/v1/forward'));
    expect(requests[0]?.body).toMatchObject({
      messages: [{ chatId: 'c1', messageId: 'm1' }],
      chatIds: ['c2', 'c3', 'c4', 'c5', 'c6'],
      comment: 'look',
    });
  });

  it('labels what was forwarded, and what was forwarded many times', async () => {
    await open([
      theirs(1, 'once', { forwarded: true, forwardCount: 1 }),
      theirs(2, 'often', { forwarded: true, forwardCount: 5 }),
    ]);
    expect(await screen.findByText('Forwarded', undefined, SLOW)).toBeInTheDocument();
    expect(screen.getByText('Forwarded many times')).toBeInTheDocument();
  });
});

describe('selecting several', () => {
  it('copies with sender and time, and stars them', async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: write },
    });
    const { container } = await open([theirs(1, 'one'), mine(2, 'two')]);
    await choose(await menuOn('one'), 'Select');
    expect(await screen.findByText('1 selected')).toBeInTheDocument();
    fireEvent.click(await bubble('two'));
    expect(await screen.findByText('2 selected')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Write a message' })).not.toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(write).toHaveBeenCalled());
    expect(write.mock.calls[0]?.[0]).toMatch(/one\n.*You: two$/);

    await choose(await menuOn('one'), 'Select');
    fireEvent.click(screen.getByRole('button', { name: 'Star' }));
    await waitFor(() => expect(requests.some((item) => item.path.endsWith('/star'))).toBe(true));
  });

  it('deleting several offers "for everyone" only when all of them allow it', async () => {
    await open([theirs(1, 'one'), mine(2, 'two')]);
    await choose(await menuOn('two'), 'Select');
    fireEvent.click(await bubble('one'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete 2 messages?' });
    expect(within(dialog).queryByRole('button', { name: 'Delete for everyone' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete for me' }));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(useMessageUi.getState().selecting).toBeNull();
  });
});
