import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { HttpResponse, http, server } from '@/test/msw';
import { MediaViewer, type ViewerItem } from './components/MediaViewer';

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

describe('a video in the viewer', () => {
  const items: ViewerItem[] = [
    { mediaId: 'v1', kind: 'video', name: 'long.mp4', caption: null, seq: 9 },
  ];

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

  it('reloads the player even if the new link happens to be the same', async () => {
    server.use(
      thumbnails,
      emptyGallery,
      http.get('*/v1/media/:id/link', () =>
        HttpResponse.json({
          url: '/v1/media/v1/content?sig=same',
          expiresAt: new Date(Date.now() + 900_000).toISOString(),
        }),
      ),
    );
    const { baseElement } = render(
      <QueryHarness>
        <MediaViewer chatId="c1" localItems={items} startId="v1" onClose={vi.fn()} />
      </QueryHarness>,
    );
    await waitFor(() => expect(baseElement.querySelector('video')).not.toBeNull());
    const video = baseElement.querySelector('video') as HTMLVideoElement;
    const load = vi.spyOn(video, 'load').mockImplementation(() => undefined);
    fireEvent.error(video);
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
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
