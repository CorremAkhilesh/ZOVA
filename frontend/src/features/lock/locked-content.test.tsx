import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setSignedIn } from '@/features/auth/session';
import { ChatGallery } from '@/features/media/components/ChatGallery';
import { useMessageUi } from '@/features/messages/store';
import { axe } from '@/test/axe';
import { chatFixture, messageFixture, personFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server, sessionFixture } from '@/test/msw';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { useLockStore } from './store';
import { serveLock } from './test-server';
import { resetLockState, SLOW, typePin } from './test-utils';

vi.setConfig({ testTimeout: 40_000 });

const secret = () =>
  chatFixture({
    id: 'c-secret',
    seq: 1,
    locked: true,
    otherUser: personFixture({ id: 'u-kiran', displayName: 'Kiran Secret', username: 'kiran' }),
  });
const open = () =>
  chatFixture({
    id: 'c1',
    seq: 1,
    otherUser: personFixture({ id: 'u-rahul', displayName: 'Rahul Menon', username: 'rahul' }),
  });
const starred = (chatId: string, text: string) => ({
  message: messageFixture(1, { id: `m-${chatId}`, chatId, text, starred: true }),
  starredAt: '2026-11-06T10:00:00.000Z',
});

beforeEach(() => {
  resetLockState();
  useMessageUi.setState({ chatMenu: null, menu: null, jump: null, forwarding: null });
});

/** Answers like a server that knows nothing of the lock: the app must still hide them. */
function serveStars() {
  const asked: string[] = [];
  server.use(
    http.get('*/v1/stars', ({ request }) => {
      asked.push(new URL(request.url).search);
      return HttpResponse.json({
        items: [starred('c-secret', 'the locked plan'), starred('c1', 'the open plan')],
        nextCursor: null,
      });
    }),
  );
  return asked;
}

async function unlockWith(notice: HTMLElement) {
  fireEvent.click(within(notice).getByRole('button', { name: 'Unlock' }));
  await typePin('Enter your PIN', '1234', await screen.findByRole('dialog', {}, SLOW));
}

describe('starred messages in locked chats', () => {
  it('hides them behind one line until the PIN, then asks the server for them', async () => {
    serveLock('1234');
    const asked = serveStars();
    await seedLocal([secret(), open()]);
    const { container } = await renderApp('/starred', { width: DESKTOP_WIDTH });
    expect(await screen.findByText('the open plan', undefined, SLOW)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('the locked plan');
    expect(document.body).not.toHaveTextContent('Kiran');
    const notice = screen.getByTestId('locked-hidden');
    expect(notice).toHaveTextContent('Messages in locked chats are hidden. Unlock to see them.');
    expect(asked.every((search) => !search.includes('includeLocked'))).toBe(true);
    expect(await axe(container)).toHaveNoViolations();

    await unlockWith(notice);
    expect(await screen.findByText('the locked plan', undefined, SLOW)).toBeInTheDocument();
    expect(asked.at(-1)).toContain('includeLocked=true');
    expect(screen.queryByTestId('locked-hidden')).toBeNull();
  });

  it('one locked chat: no name in the title, and the server saying it left some out', async () => {
    serveLock('1234');
    server.use(
      http.get('*/v1/stars', () =>
        HttpResponse.json({ items: [], nextCursor: null, lockedHidden: true }),
      ),
    );
    await seedLocal([secret(), open()]);
    await renderApp('/starred?chatId=c-secret', { width: DESKTOP_WIDTH });
    expect(await screen.findByTestId('locked-hidden', {}, SLOW)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Starred messages' })).toBeInTheDocument();
    expect(screen.queryByText(/Nothing starred yet/)).toBeNull();
    expect(document.body).not.toHaveTextContent('Kiran');
  });
});

describe('forwarding while chats are locked', () => {
  it('does not offer locked chats until the PIN, and says why', async () => {
    serveLock('1234');
    await seedLocal(
      [secret(), open()],
      [messageFixture(1, { chatId: 'c1', senderId: 'u-rahul', text: 'share this' })],
    );
    const { container } = await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    fireEvent.contextMenu(await screen.findByText('share this', undefined, SLOW));
    const menu = await screen.findByRole('menu', { name: 'Message actions' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Forward' }));
    const dialog = await screen.findByRole('dialog', { name: 'Forward to' });
    const list = within(dialog).getByRole('list', { name: 'Forward to' });
    await within(list).findByRole('button', { name: /Saved Messages/ }, SLOW);
    expect(within(list).queryByRole('button', { name: /Kiran/ })).toBeNull();
    const notice = within(dialog).getByTestId('locked-hidden');
    expect(notice).toHaveTextContent('Locked chats are hidden. Unlock to forward to them.');
    expect(await axe(container)).toHaveNoViolations();

    await unlockWith(notice);
    expect(await within(list).findByRole('button', { name: /Kiran/ }, SLOW)).toBeInTheDocument();
    expect(within(dialog).queryByTestId('locked-hidden')).toBeNull();
  });
});

describe('the media gallery of a locked chat', () => {
  it('shows nothing and asks for nothing until the PIN', async () => {
    const asked: string[] = [];
    server.use(
      http.get('*/v1/chats/:id/media', ({ params }) => {
        asked.push(String(params.id));
        return HttpResponse.json({ items: [], hasMore: false });
      }),
    );
    await seedLocal([secret()]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Inside the app shell the session is always known (its guards wait for it).
    setSignedIn(client, sessionFixture());
    render(
      <QueryClientProvider client={client}>
        <ChatGallery chatId="c-secret" onOpen={() => undefined} />
      </QueryClientProvider>,
    );
    expect(await screen.findByTestId('locked-hidden', {}, SLOW)).toHaveTextContent(
      'This chat is locked. Unlock to see its media.',
    );
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(asked).toEqual([]);

    act(() => useLockStore.getState().unlockChats());
    expect(await screen.findByRole('tablist')).toBeInTheDocument();
    await waitFor(() => expect(asked).toEqual(['c-secret']));
  });
});
