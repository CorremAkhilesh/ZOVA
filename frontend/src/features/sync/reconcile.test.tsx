import { Blob as NodeBlob } from 'node:buffer';
import { act, render, screen, waitFor } from '@testing-library/react';
import type { Message } from '@zuvo/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withDeadline } from '@/features/media/api';
import { formatDuration } from '@/features/media/process';
import { chatFixture, ME_ID, messageFixture } from '@/test/chat-fixtures';
import { applyChats } from './apply';
import { reconcileWithServer } from './history';
import { getUserDb, type LocalDb } from './local-db';
import { Outbox } from './outbox';
import { useLive } from './use-live';

let db: LocalDb;

const outbox = () =>
  new Outbox({
    db,
    me: ME_ID,
    transport: {
      isConnected: () => false,
      send: async () => {
        throw new Error('not used');
      },
    },
  });

const video = (clientMsgId: string, id = 'm-video'): Message =>
  messageFixture(2, {
    id,
    senderId: ME_ID,
    clientMsgId,
    type: 'video',
    media: {
      id: 'media-1',
      kind: 'video',
      mime: 'video/mp4',
      size: 10,
      name: 'long.mp4',
      width: 640,
      height: 360,
      duration: 498.9,
      placeholder: null,
      hasThumbnail: true,
    },
  });

const enqueue = () =>
  outbox().enqueueMedia({
    chatId: 'c1',
    caption: '',
    info: { kind: 'video', name: 'long.mp4', mime: 'video/mp4', size: 10 },
    // jsdom's own Blob cannot be stored.
    file: new NodeBlob(['0123456789']) as unknown as Blob,
  });

const serverWith = (items: Message[]) => ({
  history: vi.fn(async () => ({ items, hasMore: false })),
  getChat: vi.fn(async () => chatFixture({ seq: 2 })),
});

beforeEach(async () => {
  db = getUserDb(ME_ID);
  await db.open();
  await applyChats(db, [chatFixture()]);
});

describe('a message the server has but this device still shows as uploading', () => {
  it('becomes sent, with its media, and the outbox lets go of it and its file', async () => {
    const id = await enqueue();
    expect((await db.messages.toArray())[0]).toMatchObject({ status: 'pending', seq: null });

    await reconcileWithServer(db, ME_ID, serverWith([video(id)]));

    const rows = await db.messages.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'sent',
      seq: 2,
      order: 2,
      media: { id: 'media-1' },
    });
    expect(await db.outbox.count()).toBe(0);
    expect(await db.files.count()).toBe(0);
  });

  it('also brings the chat list up to date, so its preview loses the clock', async () => {
    const id = await enqueue();
    const preview = (await db.chats.get('c1'))?.lastMessage;
    expect(preview?.seq).toBeGreaterThan((await db.chats.get('c1'))?.seq ?? 0);

    const chat = chatFixture({ seq: 2 });
    await reconcileWithServer(db, ME_ID, {
      history: async () => ({ items: [video(id)], hasMore: false }),
      getChat: async () => chat,
    });
    expect((await db.chats.get('c1'))?.seq).toBe(2);
  });

  it('leaves a message alone while the server does not have it yet', async () => {
    await enqueue();
    await reconcileWithServer(db, ME_ID, serverWith([]));
    expect((await db.messages.toArray())[0]?.status).toBe('pending');
    expect(await db.outbox.count()).toBe(1);
    expect(await db.files.count()).toBe(1);
  });

  it('asks the server nothing when nothing is unsent', async () => {
    const server = serverWith([]);
    await reconcileWithServer(db, ME_ID, server);
    expect(server.history).not.toHaveBeenCalled();
  });
});

function Count() {
  const count = useLive(async () => db.messages.count(), []);
  return <p>count: {count ?? 'none'}</p>;
}

function Reader({ read }: { read: () => Promise<number> }) {
  useLive(read, []);
  return null;
}

describe('a screen reading from the local database', () => {
  it('recovers when a read fails after the last write', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(<Count />);
    await screen.findByText('count: 0');

    const failing = vi
      .spyOn(db.messages, 'count')
      .mockRejectedValueOnce(Object.assign(new Error('read failed'), { name: 'UnknownError' }));
    await act(() => enqueue());

    // The first read after the write fails. No other write follows, and the screen still catches up.
    await waitFor(() => expect(screen.getByText('count: 1')).toBeInTheDocument(), {
      timeout: 15_000,
    });
    expect(logged).toHaveBeenCalledWith('[live] local read failed: UnknownError');
    failing.mockRestore();
    logged.mockRestore();
  }, 20_000);

  it('reads again when the window comes back', async () => {
    const read = vi.fn(async () => 1);
    render(<Reader read={read} />);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1), { timeout: 5000 });
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2), { timeout: 5000 });
  });
});

describe('an upload request with no answer', () => {
  it('gives up after its deadline', async () => {
    const hung = (signal: AbortSignal) =>
      new Promise<void>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    await expect(withDeadline(5, undefined, hung)).rejects.toThrow('aborted');
  });

  it('stops when the upload is cancelled', async () => {
    const outer = new AbortController();
    const work = withDeadline(
      60_000,
      outer.signal,
      (signal) =>
        new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    outer.abort();
    await expect(work).rejects.toThrow('aborted');
  });

  it('passes the answer through', async () => {
    await expect(withDeadline(1000, undefined, async () => 'done')).resolves.toBe('done');
  });
});

describe('a video length', () => {
  it('reads the same as the player, rounded down', () => {
    expect(formatDuration(498.9)).toBe('8:18');
  });
});
