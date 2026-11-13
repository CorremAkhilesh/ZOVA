import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MediaInfo } from '@zuvo/protocol';
import { describe, expect, it } from 'vitest';
import { previewText } from '@/features/chats/view';
import { useSyncStore } from '@/features/sync/store';
import { axe } from '@/test/axe';
import { chatFixture, ME_ID, messageFixture } from '@/test/chat-fixtures';
import { HttpResponse, http, server } from '@/test/msw';
import { DESKTOP_WIDTH, MOBILE_WIDTH, renderApp } from '@/test/render-app';
import { seedLocal } from '@/test/seed';
import { fitWithin, formatBytes, formatDuration, kindOf, outputType, renamed } from './process';

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

const png = (name = 'a.png', size = 1000) => {
  const file = new File([new Uint8Array(1)], name, { type: 'image/png' });
  Object.defineProperty(file, 'size', { value: size });
  return file;
};

const thumbnails = http.get('*/v1/media/:id/content', () =>
  HttpResponse.arrayBuffer(new ArrayBuffer(4), { headers: { 'content-type': 'image/webp' } }),
);
const emptyGallery = http.get('*/v1/chats/:id/media', () =>
  HttpResponse.json({ items: [], hasMore: false }),
);

describe('small helpers', () => {
  it('fits a picture within the limit, without enlarging', () => {
    expect(fitWithin(5120, 2560, 2560)).toEqual({ width: 2560, height: 1280 });
    expect(fitWithin(100, 50, 2560)).toEqual({ width: 100, height: 50 });
  });

  it('keeps PNG for transparency, and compresses the rest as JPEG', () => {
    expect(outputType('image/png')).toBe('image/png');
    expect(outputType('image/heic')).toBe('image/jpeg');
    expect(renamed('IMG_1.HEIC', 'image/jpeg')).toBe('IMG_1.jpg');
  });

  it('decides the kind of file', () => {
    expect(kindOf({ type: 'image/png' })).toBe('image');
    expect(kindOf({ type: 'video/mp4' })).toBe('video');
    expect(kindOf({ type: 'application/pdf' })).toBe('document');
    expect(kindOf({ type: '' })).toBe('document');
  });

  it('formats sizes and durations', () => {
    expect(formatBytes(512, 'en')).toBe('512 B');
    expect(formatBytes(1536, 'en')).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024, 'en')).toBe('5 MB');
    expect(formatDuration(75)).toBe('1:15');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(498.9)).toBe('8:18');
  });

  it('writes chat list previews', () => {
    const labels = { photo: 'Photo', video: 'Video' };
    expect(previewText({ type: 'image', preview: '' }, labels)).toBe('📷 Photo');
    expect(previewText({ type: 'image', preview: 'Beach' }, labels)).toBe('📷 Beach');
    expect(previewText({ type: 'video', preview: '' }, labels)).toBe('🎥 Video');
    expect(previewText({ type: 'document', preview: 'a.pdf' }, labels)).toBe('📄 a.pdf');
    expect(previewText({ type: 'text', preview: 'hi' }, labels)).toBe('hi');
  });
});

describe('bubbles', () => {
  const open = async (messages: ReturnType<typeof photo>[], width = DESKTOP_WIDTH) => {
    server.use(thumbnails, emptyGallery);
    await seedLocal(
      [chatFixture({ seq: messages.length, lastReadSeq: messages.length })],
      messages,
    );
    const view = await renderApp('/chats/c1', { width });
    const thread = await screen.findByRole('list', { name: 'Asha Verma' });
    return { ...view, thread };
  };

  it('shows a photo with its blur and caption', async () => {
    const { thread, container } = await open([photo(1, 'p1', { text: 'Beach' })]);
    expect(await within(thread).findByRole('button', { name: /Open photo/ })).toBeInTheDocument();
    expect(thread.querySelector('img.blur-md')).toHaveAttribute('src', info('p1').placeholder);
    expect(within(thread).getByText('Beach')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('groups an album into one bubble, with +N past four', async () => {
    const albumId = 'album-1';
    const items = [1, 2, 3, 4, 5, 6].map((n) => photo(n, `p${n}`, { albumId }));
    const { thread } = await open(items);
    expect(await within(thread).findAllByRole('button', { name: /Open photo/ })).toHaveLength(4);
    expect(within(thread).getByText('+2')).toBeInTheDocument();
    expect(
      within(thread)
        .getAllByRole('listitem')
        .filter((li) => li.querySelector('button')),
    ).toHaveLength(1);
  });

  it('shows a video with its duration', async () => {
    const { thread } = await open([
      messageFixture(1, {
        type: 'video',
        text: null,
        media: info('v1', { kind: 'video', mime: 'video/mp4', duration: 75 }),
      }),
    ]);
    expect(await within(thread).findByRole('button', { name: /Open video/ })).toBeInTheDocument();
    expect(within(thread).getByText('1:15')).toBeInTheDocument();
  });

  it('shows a document card with a download button', async () => {
    const { thread } = await open([
      messageFixture(1, {
        type: 'document',
        text: 'The figures',
        media: info('d1', {
          kind: 'document',
          mime: 'application/pdf',
          name: 'q3.pdf',
          size: 2048,
          hasThumbnail: false,
        }),
      }),
    ]);
    expect(await within(thread).findByText('q3.pdf')).toBeInTheDocument();
    expect(within(thread).getByText('PDF · 2 KB')).toBeInTheDocument();
    expect(within(thread).getByRole('button', { name: 'Download q3.pdf' })).toBeInTheDocument();
    expect(within(thread).getByText('The figures')).toBeInTheDocument();
  });

  it('says Media not available when the file is gone, and does not crash', async () => {
    await seedLocal([chatFixture({ seq: 1, lastReadSeq: 1 })], [photo(1, 'gone')]);
    server.use(
      http.get('*/v1/media/:id/content', () =>
        HttpResponse.json(
          { code: 'MEDIA_NOT_FOUND', message: 'x', requestId: 'r' },
          { status: 404 },
        ),
      ),
    );
    await renderApp('/chats/c1', { width: MOBILE_WIDTH });
    expect(await screen.findByText('Media not available')).toBeInTheDocument();
  });

  it('shows a progress ring with a cancel button while uploading, and cancelling works', async () => {
    const db = await seedLocal([chatFixture()]);
    const clientMsgId = '0190a000-0000-7000-8000-00000000000b';
    await db.outbox.add({
      clientMsgId,
      chatId: 'c1',
      text: '',
      attempts: 0,
      state: 'failed',
    });
    await db.messages.add({
      ...messageFixture(1, {
        senderId: ME_ID,
        clientMsgId,
        type: 'image',
        text: null,
        media: info('', { size: 100, hasThumbnail: false, placeholder: null }),
      }),
      key: `${ME_ID}:${clientMsgId}`,
      id: null,
      seq: null,
      order: 1e12 + 1,
      status: 'pending',
      uploadedBytes: 40,
    });
    const user = userEvent.setup();
    await renderApp('/chats/c1', { width: DESKTOP_WIDTH });
    await waitFor(() => expect(useSyncStore.getState().client).not.toBeNull());
    const cancel = await screen.findByRole('button', { name: 'Cancel upload, 40% done' });
    await user.click(cancel);
    await waitFor(async () => expect(await db.messages.count()).toBe(0));
  });

  it('enables attach, with Camera on phones only', async () => {
    const user = userEvent.setup();
    const { unmount } = await open([photo(1, 'p1')]);
    await user.click(screen.getByRole('button', { name: 'Attach a file' }));
    expect(await screen.findByRole('button', { name: 'Photos & videos' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Document' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Camera' })).not.toBeInTheDocument();
    unmount();

    await renderApp('/chats/c1', { width: MOBILE_WIDTH });
    await user.click(await screen.findByRole('button', { name: 'Attach a file' }));
    expect(await screen.findByRole('button', { name: 'Camera' })).toBeInTheDocument();
  });

  it('opens the preview sheet from a pasted image', async () => {
    await open([photo(1, 'p1')]);
    const box = screen.getByRole('textbox', { name: 'Write a message' });
    fireEvent.paste(box, { clipboardData: { files: [png('pasted.png')] } });
    expect(await screen.findByRole('dialog', { name: 'Send 1 file' })).toBeInTheDocument();
    expect(screen.getByText('pasted.png')).toBeInTheDocument();
  });

  it('shows an overlay while dragging, and opens the sheet on drop', async () => {
    const { thread } = await open([photo(1, 'p1')]);
    const dataTransfer = { types: ['Files'], files: [png('dropped.png')] };
    fireEvent.dragEnter(thread, { dataTransfer });
    expect(await screen.findByText('Drop files to send')).toBeInTheDocument();
    fireEvent.drop(thread, { dataTransfer });
    expect(await screen.findByText('dropped.png')).toBeInTheDocument();
    expect(screen.queryByText('Drop files to send')).not.toBeInTheDocument();
  });

  it('opens the viewer on click', async () => {
    const user = userEvent.setup();
    const { thread } = await open([photo(1, 'p1', { text: 'Beach' })]);
    await user.click(await within(thread).findByRole('button', { name: /Open photo/ }));
    expect(await screen.findByRole('dialog', { name: 'p1.jpg' })).toBeInTheDocument();
    act(() => undefined);
  });
});
