import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useSyncStore } from '@/features/sync/store';
import { axe } from '@/test/axe';
import { chatFixture, ME_ID, messageFixture, personFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, MOBILE_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { lastSocket } from '@/test/socket-mock';

// The first render of the whole app can pass 5 s on a loaded machine (coverage, CI).
vi.setConfig({ testTimeout: 30_000 });
const SEQ = 40;
const chat = chatFixture({ seq: SEQ, lastReadSeq: SEQ });
const history = Array.from({ length: SEQ }, (_, index) =>
  messageFixture(index + 1, { senderId: index % 3 === 0 ? ME_ID : 'u-asha' }),
);

async function ready() {
  await waitFor(() => expect(useSyncStore.getState().client).not.toBeNull());
}

async function connectSocket() {
  await ready();
  act(() => lastSocket().receive('connect'));
}

describe('conversation', () => {
  it('shows the header and the messages from Dexie', async () => {
    await seedLocal([chat], history);
    const { container } = await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    const list = await screen.findByRole('list', { name: 'Asha Verma' });
    expect(await within(list).findByText('message 40')).toBeInTheDocument();
    expect(screen.getByText('@asha')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('loads the newest page from the server when this device has none', async () => {
    await seedLocal([chat]);
    const seen: string[] = [];
    server.use(
      http.get('*/v1/chats/c1/messages', ({ request }) => {
        seen.push(new URL(request.url).search);
        return HttpResponse.json({ items: history.slice(-30), hasMore: false });
      }),
    );
    await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    expect(await screen.findByText('message 40')).toBeInTheDocument();
    expect(seen[0]).not.toContain('before');
  });

  it('shows the empty state for a chat with no messages', async () => {
    await seedLocal([chatFixture()]);
    const { container } = await renderApp('/chats/c1', { width: MOBILE_WIDTH });
    expect(
      await screen.findByText('No messages yet. Say hello to Asha Verma!'),
    ).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('marks sent, pending and failed messages differently', async () => {
    const db = await seedLocal([chat], [messageFixture(1, { senderId: ME_ID, text: 'delivered' })]);
    await db.messages.add({
      ...messageFixture(1, { senderId: ME_ID, text: 'waiting', clientMsgId: 'c-wait' }),
      key: `${ME_ID}:c-wait`,
      id: null,
      seq: null,
      order: 1e12 + 1,
      status: 'pending',
    });
    await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    await screen.findByText('waiting');
    expect(screen.getByRole('img', { name: 'Sending' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Sent' })).toBeInTheDocument();
  });

  it('offers a retry on a failed message, and sends it again', async () => {
    const db = await seedLocal([chat]);
    const clientMsgId = '0190a000-0000-7000-8000-000000000001';
    await db.outbox.add({ clientMsgId, chatId: 'c1', text: 'nope', attempts: 5, state: 'failed' });
    await db.messages.add({
      ...messageFixture(1, { senderId: ME_ID, text: 'nope', clientMsgId }),
      key: `${ME_ID}:${clientMsgId}`,
      id: null,
      seq: null,
      order: 1e12 + 1,
      status: 'failed',
    });
    const user = userEvent.setup();
    await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    await connectSocket();
    const retry = await screen.findByRole('button', { name: 'Not sent — tap to retry' });
    await user.click(retry);
    await waitFor(() =>
      expect(lastSocket().emitted.some((entry) => entry.event === 'message:send')).toBe(true),
    );
    await waitFor(() => expect(screen.queryByText(/Not sent/)).not.toBeInTheDocument());
  });

  it('goes to the 404 screen for a chat that does not exist', async () => {
    server.use(
      http.get('*/v1/chats/:id', () =>
        HttpResponse.json({ code: 'NOT_FOUND', message: 'x', requestId: 'r' }, { status: 404 }),
      ),
    );
    await renderApp('/chats/nope', { width: DESKTOP_WIDTH });
    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument();
  });

  it('fetches a chat this device has not seen, and opens it', async () => {
    server.use(
      http.get('*/v1/chats/c9', () => HttpResponse.json({ chat: chatFixture({ id: 'c9' }) })),
    );
    await renderApp('/chats/c9', { width: DESKTOP_WIDTH });
    expect(
      await screen.findByText('No messages yet. Say hello to Asha Verma!'),
    ).toBeInTheDocument();
  });

  it('explains when an unseen chat cannot open offline', async () => {
    server.use(http.get('*/v1/chats/c9', () => HttpResponse.error()));
    await renderApp('/chats/c9', { width: DESKTOP_WIDTH });
    expect(
      await screen.findByRole('heading', { name: 'Not available offline' }),
    ).toBeInTheDocument();
  });

  it('hides the composer for a deactivated person', async () => {
    await seedLocal([
      chatFixture({ otherUser: personFixture({ displayName: 'Gone', deactivated: true }) }),
    ]);
    await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    expect(await screen.findByText('This account has been deactivated.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Write a message' })).not.toBeInTheDocument();
  });

  it('opens the info pane on desktop and a card on mobile', async () => {
    await seedLocal([chat], history);
    const user = userEvent.setup();
    const { unmount } = await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    const [toggle] = await screen.findAllByRole('button', { name: 'Chat info' });
    if (!toggle) throw new Error('no info toggle');
    await user.click(toggle);
    const pane = await screen.findByRole('complementary', { name: 'Chat info' });
    expect(within(pane).getByText('On it')).toBeInTheDocument();
    await user.click(within(pane).getByRole('button', { name: 'Close chat info' }));
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
    unmount();

    await renderApp('/chats/c1', { width: MOBILE_WIDTH });
    const [mobileToggle] = await screen.findAllByRole('button', { name: 'Chat info' });
    if (!mobileToggle) throw new Error('no info toggle');
    await user.click(mobileToggle);
    expect(await screen.findByRole('dialog', { name: 'Chat info' })).toBeInTheDocument();
  });

  it('Esc returns to the list on desktop', async () => {
    await seedLocal([chat], history);
    const user = userEvent.setup();
    const { router } = await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    await screen.findByRole('list', { name: 'Asha Verma' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats'));
  });

  it('Esc closes the info pane first, giving focus back to the header, then the chat', async () => {
    await seedLocal([chat], history);
    const user = userEvent.setup();
    const { router } = await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    const header = await screen.findByRole('button', { name: /^Asha Verma.*Chat info$/ });
    await user.click(header);
    const pane = await screen.findByRole('complementary', { name: 'Chat info' });
    within(pane).getByRole('button', { name: 'Close chat info' }).focus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('complementary')).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe('/chats/c1');
    await waitFor(() => expect(header).toHaveFocus());
    await user.keyboard('{Escape}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats'));
  });

  it('Esc does nothing on mobile, which has a back button', async () => {
    await seedLocal([chat], history);
    const user = userEvent.setup();
    const { router } = await renderApp('/chats/c1', { width: MOBILE_WIDTH });
    await screen.findByRole('list', { name: 'Asha Verma' });
    await user.keyboard('{Escape}');
    expect(router.state.location.pathname).toBe('/chats/c1');
    expect(screen.getByRole('link', { name: 'Back to chats' })).toBeInTheDocument();
  });
});
