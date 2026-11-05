import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MediaInfo } from '@zuvo/protocol';
import { type ReactNode, StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axe } from '@/test/axe';
import { chatFixture, ME_ID, messageFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { MediaViewer, mergeViewerItems, toViewerItem } from './components/MediaViewer';

const info = (id: string, overrides: Partial<MediaInfo> = {}): MediaInfo => ({
  id,
  kind: 'image',
  mime: 'image/webp',
  size: 2048,
  name: `${id}.jpg`,
  width: 800,
  height: 600,
  duration: null,
  placeholder: 'data:image/webp;base64,AAAA',
  hasThumbnail: true,
  ...overrides,
});
const photo = (seq: number, id: string, overrides = {}) =>
  messageFixture(seq, { type: 'image', text: null, media: info(id), ...overrides });
const thumbnails = http.get('*/v1/media/:id/content', () =>
  HttpResponse.arrayBuffer(new ArrayBuffer(4), { headers: { 'content-type': 'image/webp' } }),
);
const emptyGallery = http.get('*/v1/chats/:id/media', () =>
  HttpResponse.json({ items: [], hasMore: false }),
);

function QueryHarness({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {children}
    </QueryClientProvider>
  );
}

const viewerItems = [1, 2, 3].flatMap((n) => {
  const item = toViewerItem(photo(n, `p${n}`, { text: `caption ${n}` }));
  return item ? [item] : [];
});

function MediaViewerHarness(props: { startId: string; onClose: () => void }) {
  return (
    <QueryHarness>
      <MediaViewer
        chatId="c1"
        localItems={viewerItems}
        startId={props.startId}
        onClose={props.onClose}
      />
    </QueryHarness>
  );
}

describe('viewer', () => {
  const items = viewerItems;

  function setup(startId = 'p2') {
    server.use(thumbnails, emptyGallery);
    const onClose = vi.fn();
    render(<MediaViewerHarness startId={startId} onClose={onClose} />);
    return onClose;
  }

  it('moves with the arrow keys and stops at the ends', async () => {
    setup();
    expect(await screen.findByText('caption 2')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(await screen.findByText('caption 3')).toBeInTheDocument();
    expect(screen.getByText('3 of 3')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByText('caption 3')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(await screen.findByText('caption 1')).toBeInTheDocument();
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('closes on Esc and from the button', async () => {
    const user = userEvent.setup();
    const onClose = setup();
    await screen.findByText('caption 2');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
    onClose.mockClear();
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on the back gesture', async () => {
    const onClose = setup();
    await screen.findByText('caption 2');
    act(() => {
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('stays open in StrictMode, which mounts everything twice in development', async () => {
    server.use(thumbnails, emptyGallery);
    const onClose = vi.fn();
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const { unmount } = render(
      <StrictMode>
        <MediaViewerHarness startId="p2" onClose={onClose} />
      </StrictMode>,
    );
    await screen.findByText('caption 2');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(back).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();

    // Really leaving goes back, once, undoing the entry it added.
    unmount();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(back).toHaveBeenCalledTimes(1);
    back.mockRestore();
  });

  it('zooms with the buttons and a double click', async () => {
    const user = userEvent.setup();
    setup();
    const image = await screen.findByRole('img', { name: 'caption 2' });
    await user.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(image.style.transform).toContain('scale(1.5)');
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(image.style.transform).toContain('scale(1)');
    fireEvent.doubleClick(image);
    expect(image.style.transform).toContain('scale(2.5)');
  });

  it('says Media not available when the picture fails', async () => {
    setup();
    fireEvent.error(await screen.findByRole('img', { name: 'caption 2' }));
    expect(await screen.findByText('Media not available')).toBeInTheDocument();
  });

  it('merges what is local with the server’s list, in chat order, once each', () => {
    const [one, two, three] = items;
    if (!one || !two || !three) throw new Error('no items');
    expect(mergeViewerItems([three, one], [two, one]).map((item) => item.seq)).toEqual([1, 2, 3]);
  });
});

describe('chat info gallery', () => {
  it('lists media and docs, and opens the viewer', async () => {
    const user = userEvent.setup();
    server.use(
      thumbnails,
      http.get('*/v1/chats/:id/media', ({ request }) => {
        const tab = new URL(request.url).searchParams.get('tab');
        return HttpResponse.json({
          items:
            tab === 'media'
              ? [photo(2, 'p2')]
              : [
                  messageFixture(1, {
                    type: 'document',
                    text: null,
                    media: info('d1', {
                      kind: 'document',
                      name: 'q3.pdf',
                      hasThumbnail: false,
                      placeholder: null,
                    }),
                  }),
                ],
          hasMore: false,
        });
      }),
    );
    await seedLocal([chatFixture()]);
    const { container } = await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    const [toggle] = await screen.findAllByRole('button', { name: 'Chat info' });
    if (!toggle) throw new Error('no toggle');
    await user.click(toggle);
    const pane = await screen.findByRole('complementary', { name: 'Chat info' });
    const opener = await within(pane).findByRole('button', { name: /Open photo/ });
    expect(await axe(container)).toHaveNoViolations();

    await user.click(within(pane).getByRole('tab', { name: 'Docs' }));
    expect(await within(pane).findByText('q3.pdf')).toBeInTheDocument();
    await user.click(within(pane).getByRole('tab', { name: 'Media' }));
    await user.click(await within(pane).findByRole('button', { name: /Open photo/ }));
    expect(await screen.findByRole('dialog', { name: 'p2.jpg' })).toBeInTheDocument();
    expect(opener).toBeDefined();
  });

  it('says so when there is nothing, or it fails', async () => {
    const user = userEvent.setup();
    server.use(emptyGallery);
    await seedLocal([chatFixture()]);
    const { unmount } = await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    const [toggle] = await screen.findAllByRole('button', { name: 'Chat info' });
    if (!toggle) throw new Error('no toggle');
    await user.click(toggle);
    expect(await screen.findByText('No photos or videos yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Docs' }));
    expect(await screen.findByText('No documents yet.')).toBeInTheDocument();
    unmount();

    server.use(http.get('*/v1/chats/:id/media', () => HttpResponse.error()));
    await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    const [again] = await screen.findAllByRole('button', { name: 'Chat info' });
    if (!again) throw new Error('no toggle');
    await user.click(again);
    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load this');
  });
});

describe('sign-out', () => {
  it('wipes cached thumbnails and waiting files with everything else', async () => {
    const { wipeLocalDatabases, getUserDb } = await import('@/features/sync/local-db');
    const db = await seedLocal([chatFixture()]);
    await db.meta.put({ key: 'probe', value: '1' });
    await wipeLocalDatabases();
    const fresh = getUserDb(ME_ID);
    await fresh.open();
    expect(await fresh.thumbs.count()).toBe(0);
    expect(await fresh.files.count()).toBe(0);
  });
});

describe('a video in the viewer', () => {
  const clip = toViewerItem(photo(9, 'v1', { type: 'video' }));
  const items = clip ? [{ ...clip, kind: 'video' as const }] : [];

  function setup() {
    let links = 0;
    server.use(
      thumbnails,
      emptyGallery,
      http.get('*/v1/media/:id/link', () => {
        links += 1;
        return HttpResponse.json({
          url: `/v1/media/v1/content?sig=${links}`,
          expiresAt: new Date(Date.now() + 900_000).toISOString(),
        });
      }),
    );
    const { container } = render(
      <QueryHarness>
        <MediaViewer chatId="c1" localItems={items} startId="v1" onClose={vi.fn()} />
      </QueryHarness>,
    );
    const player = async () => {
      await waitFor(() => expect(container.ownerDocument.querySelector('video')).not.toBeNull());
      return container.ownerDocument.querySelector('video') as HTMLVideoElement;
    };
    return { player, links: () => links };
  }

  it('gets a new link when the old one stops working, and carries on from the same place', async () => {
    const { player, links } = setup();
    const video = await player();
    expect(video.getAttribute('src')).toContain('sig=1');
    Object.defineProperty(video, 'currentTime', { value: 300, writable: true });

    fireEvent.error(video);
    await waitFor(() => expect(video.getAttribute('src')).toContain('sig=2'));
    expect(links()).toBe(2);
    expect(screen.queryByText('Media not available')).not.toBeInTheDocument();

    video.currentTime = 0;
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(300);
  });

  it('says it is not available when a new link fails too: the file is gone', async () => {
    const { player, links } = setup();
    const video = await player();
    fireEvent.error(video);
    await waitFor(() => expect(video.getAttribute('src')).toContain('sig=2'));
    fireEvent.error(video);
    expect(await screen.findByText('Media not available')).toBeInTheDocument();
    expect(links()).toBe(2);
  });
});
