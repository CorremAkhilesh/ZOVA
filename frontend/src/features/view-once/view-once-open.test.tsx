import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MediaInfo, Message } from '@zuvo/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from '@/test/axe';
import { chatFixture, ME_ID, messageFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';

vi.setConfig({ testTimeout: 30_000 });
const SLOW = { timeout: 10_000 };
const FILE_URL = '/v1/media/p1/content?variant=full&sig=once';

const media = (kind: 'image' | 'video' = 'image'): MediaInfo => ({
  id: 'p1',
  kind,
  mime: kind === 'image' ? 'image/webp' : 'video/mp4',
  size: 2048,
  name: 'p1.webp',
  width: 800,
  height: 600,
  duration: kind === 'video' ? 4 : null,
  waveform: null,
  placeholder: null,
  hasThumbnail: false,
});

const viewOnce = (overrides: Partial<Message> = {}) =>
  messageFixture(1, {
    type: 'image',
    text: null,
    media: media(),
    viewOnce: true,
    clientMsgId: null,
    ...overrides,
  });

let requests: string[];
let opens: number;
const record = ({ request }: { request: Request }) => {
  requests.push(new URL(request.url).pathname + new URL(request.url).search);
};

beforeEach(() => {
  requests = [];
  opens = 0;
  server.events.on('request:start', record);
  server.use(
    http.get('*/v1/chats/:id/media', () => HttpResponse.json({ items: [], hasMore: false })),
    http.post('*/v1/chats/:id/messages/:messageId/view-once', () => {
      opens += 1;
      if (opens > 1) {
        return HttpResponse.json(
          { code: 'VIEW_ONCE_OPENED', message: 'Already opened', requestId: 'r' },
          { status: 410 },
        );
      }
      return HttpResponse.json({
        url: FILE_URL,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
    }),
    http.get('*/v1/media/p1/content', () =>
      HttpResponse.arrayBuffer(new Uint8Array([1, 2, 3]).buffer, {
        headers: { 'content-type': 'image/webp' },
      }),
    ),
  );
});
afterEach(() => {
  server.events.removeListener('request:start', record);
});

async function openChat(message: Message) {
  await seedLocal([chatFixture({ seq: 1 })], [message]);
  return renderApp('/chats/c1', { width: DESKTOP_WIDTH });
}

describe('a view-once photo I received', () => {
  it('shows no preview, opens once in its own viewer, then says "Opened"', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL');
    const { container } = await openChat(viewOnce());
    const open = await screen.findByRole('button', { name: 'Open view-once photo' }, SLOW);
    expect(open).toHaveTextContent('Photo');
    expect(open).toHaveTextContent('View once');
    expect(container.querySelector('[data-seq="1"] img')).toBeNull();
    expect(await axe(container)).toHaveNoViolations();

    await userEvent.setup().click(open);
    const viewer = await screen.findByRole('dialog', { name: 'View-once photo' });
    expect(viewer).toHaveTextContent('Screenshots can’t be blocked in a browser.');
    await waitFor(() =>
      expect(viewer.querySelector('img')).toHaveAttribute('src', expect.stringMatching(/^blob:/)),
    );
    expect(within(viewer).queryByRole('button', { name: /Download/ })).toBeNull();
    expect(within(viewer).queryByRole('button', { name: /Forward/ })).toBeNull();
    expect(await axe(document.body)).toHaveNoViolations();

    fireEvent.keyDown(viewer, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(revoke).toHaveBeenCalled();
    expect(await screen.findByText('Opened')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open view-once photo' })).toBeNull();
    expect(opens).toBe(1);
    // Never a thumbnail, and never the ordinary link that could be asked for again.
    expect(requests.some((path) => path.includes('variant=thumb'))).toBe(false);
    expect(requests.some((path) => path.includes('/link'))).toBe(false);
    revoke.mockRestore();
  });

  it('says "Already opened" when another device opened it first', async () => {
    opens = 1;
    await openChat(viewOnce());
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Open view-once photo' }, SLOW));
    expect(await screen.findByText('Already opened')).toBeInTheDocument();
    expect(await screen.findByText('Opened')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('falls back to "Opened" when the file is gone, never a broken image', async () => {
    server.use(http.get('*/v1/media/p1/content', () => new HttpResponse(null, { status: 404 })));
    await openChat(viewOnce());
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Open view-once photo' }, SLOW));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await screen.findByText('Opened')).toBeInTheDocument();
  });

  it('a video says so and opens the same way', async () => {
    await openChat(viewOnce({ type: 'video', media: media('video') }));
    const open = await screen.findByRole('button', { name: 'Open view-once video' }, SLOW);
    expect(open).toHaveTextContent('Video');
    await userEvent.setup().click(open);
    const viewer = await screen.findByRole('dialog', { name: 'View-once video' });
    expect(viewer.querySelector('video')).toHaveAttribute(
      'controlslist',
      'nodownload noremoteplayback',
    );
  });

  it('offers reply but not forward or star in the menu', async () => {
    await openChat(viewOnce());
    const bubble = await screen.findByRole('button', { name: 'Open view-once photo' }, SLOW);
    fireEvent.contextMenu(bubble.closest('[data-seq]') as HTMLElement);
    const menu = await screen.findByRole('menu', { name: 'Message actions' });
    expect(within(menu).getByRole('menuitem', { name: 'Reply' })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: 'Forward' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Star' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: /Download/ })).toBeNull();
  });
});

describe('a view-once photo I sent', () => {
  it('says "View once" until it is opened, then "Opened", and never opens from here', async () => {
    const { container } = await openChat(viewOnce({ senderId: ME_ID }));
    const bubble = (await screen.findByText('View once', {}, SLOW)).closest('[data-seq]');
    expect(bubble).toHaveTextContent('Photo');
    expect(screen.queryByRole('button', { name: /Open view-once/ })).toBeNull();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('shows "Opened" once the other person opened it', async () => {
    await openChat(viewOnce({ senderId: ME_ID, viewOnceOpened: true }));
    expect(await screen.findByText('Opened', {}, SLOW)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Open view-once/ })).toBeNull();
  });
});
