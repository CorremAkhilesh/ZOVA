import { Blob as NodeBlob } from 'node:buffer';
import type { MediaInfo } from '@zuvo/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyChats, applyLiveMessage } from '@/features/sync/apply';
import { getUserDb, type LocalDb } from '@/features/sync/local-db';
import { Outbox } from '@/features/sync/outbox';
import { ApiClientError } from '@/lib/api-client';
import { chatFixture, ME_ID, messageFixture } from '@/test/chat-fixtures';
import type { MediaApi } from './api';
import { MediaUploader } from './uploader';

const SIZE = 10;
const ALBUM = '0190a000-0000-7000-8000-00000000000a';
let db: LocalDb;
let connected: boolean;
let sent: unknown[];
let server: { offset: number; created: number; completed: number; chunks: number[] };
let failNext: Error | null;

const info = { kind: 'document' as const, name: 'a.pdf', mime: 'application/pdf', size: SIZE };
const mediaInfo: MediaInfo = {
  id: 'm-1',
  kind: 'document',
  mime: 'application/pdf',
  size: SIZE,
  name: 'a.pdf',
  width: null,
  height: null,
  duration: null,
  placeholder: null,
  hasThumbnail: false,
};

const api = () =>
  ({
    create: async () => {
      server.created += 1;
      return { uploadId: 'u-1', offset: 0, size: SIZE, status: 'pending' as const };
    },
    state: async () => ({
      uploadId: 'u-1',
      offset: server.offset,
      size: SIZE,
      status: 'pending' as const,
    }),
    sendChunk: async (_id: string, offset: number, chunk: Blob) => {
      if (failNext) {
        const error = failNext;
        failNext = null;
        throw error;
      }
      server.chunks.push(offset);
      server.offset = offset + chunk.size;
      return server.offset;
    },
    setPoster: async () => ({ ok: true as const }),
    complete: async () => {
      server.completed += 1;
      return mediaInfo;
    },
    cancel: async () => ({ ok: true as const }),
  }) as unknown as MediaApi;

function build() {
  const outbox = new Outbox({
    db,
    me: ME_ID,
    transport: {
      isConnected: () => connected,
      send: async (payload) => {
        sent.push(payload);
        return {
          ok: true,
          data: {
            messageId: 'msg',
            seq: sent.length,
            createdAt: '2026-11-05T10:00:00.000Z',
            duplicate: false,
          },
        };
      },
    },
  });
  const uploader = new MediaUploader({
    db,
    me: ME_ID,
    api: api(),
    outbox,
    chunkBytes: 4,
    retryBaseMs: 1,
  });
  return { outbox, uploader };
}

const enqueue = (outbox: Outbox, caption = 'look', albumId?: string) =>
  outbox.enqueueMedia({
    chatId: 'c1',
    caption,
    info,
    // jsdom's own Blob cannot be stored.
    file: new NodeBlob(['0123456789']) as unknown as Blob,
    albumId,
  });

const onlyRow = async () => (await db.messages.toArray())[0];

beforeEach(async () => {
  db = getUserDb(ME_ID);
  await db.open();
  await applyChats(db, [chatFixture()]);
  connected = true;
  sent = [];
  failNext = null;
  server = { offset: 0, created: 0, completed: 0, chunks: [] };
});

describe('media in the outbox', () => {
  it('shows at once, uploads in chunks, then sends the message', async () => {
    const { outbox, uploader } = build();
    const id = await enqueue(outbox);
    expect(await onlyRow()).toMatchObject({
      status: 'pending',
      type: 'document',
      uploadedBytes: 0,
    });
    expect((await db.chats.get('c1'))?.lastMessage).toMatchObject({
      type: 'document',
      preview: 'a.pdf · look',
    });

    await uploader.run();
    expect(server.chunks).toEqual([0, 4, 8]);
    expect(server.completed).toBe(1);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ chatId: 'c1', clientMsgId: id, mediaIds: ['m-1'], caption: 'look' });
    await vi.waitFor(async () => expect((await onlyRow())?.status).toBe('sent'));
    expect((await onlyRow())?.media?.id).toBe('m-1');
    expect(await db.files.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('keeps the album together', async () => {
    const { outbox, uploader } = build();
    await enqueue(outbox, '', ALBUM);
    await uploader.run();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ albumId: ALBUM });
    expect(sent[0]).not.toHaveProperty('caption');
  });

  it('does not hold up text messages behind it', async () => {
    const { outbox } = build();
    await enqueue(outbox);
    await outbox.enqueue('c1', 'quick question');
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ text: 'quick question' });
  });
});

describe('resuming', () => {
  it('after a reload: the file and upload id survive, and it continues from the server’s offset', async () => {
    const first = build();
    await enqueue(first.outbox);
    // The tab dies after the first chunk.
    const dying = new MediaUploader({
      db,
      me: ME_ID,
      api: {
        ...api(),
        sendChunk: async (_id: string, offset: number, chunk: Blob) => {
          server.chunks.push(offset);
          server.offset = offset + chunk.size;
          dying.stop();
          throw new ApiClientError(0, 'gone');
        },
      } as unknown as MediaApi,
      outbox: first.outbox,
      chunkBytes: 4,
    });
    await dying.run();
    expect(await db.files.count()).toBe(1);
    expect(server.created).toBe(1);

    const { uploader } = build();
    await uploader.run();
    expect(server.created).toBe(1);
    expect(server.chunks).toEqual([0, 4, 8]);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
  });

  it('a lost connection is not a failure: it carries on afterwards', async () => {
    const { outbox, uploader } = build();
    await enqueue(outbox);
    failNext = new ApiClientError(0, 'offline');
    await uploader.run();
    expect((await db.outbox.toArray())[0]).toMatchObject({ state: 'pending', attempts: 0 });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    uploader.stop();
  });

  it('sends nothing twice once the echo has arrived', async () => {
    const { outbox, uploader } = build();
    const id = await enqueue(outbox);
    connected = false;
    await uploader.run();
    const echo = messageFixture(1, {
      senderId: ME_ID,
      clientMsgId: id,
      type: 'document',
      media: mediaInfo,
    });
    await db.meta.put({ key: 'cursor', value: '0' });
    await applyLiveMessage(db, ME_ID, echo, '1');
    connected = true;
    await outbox.flush();
    expect(sent).toEqual([]);
    expect(await db.files.count()).toBe(0);
  });
});

describe('failing and cancelling', () => {
  it('shows Not sent when the server refuses the file', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { outbox, uploader } = build();
    await enqueue(outbox);
    failNext = new ApiClientError(415, 'Not allowed');
    await uploader.run();
    await vi.waitFor(async () => expect((await onlyRow())?.status).toBe('failed'));
    expect(sent).toEqual([]);
    logged.mockRestore();
  });

  it('gives up after repeated server errors', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { outbox } = build();
    await enqueue(outbox);
    let calls = 0;
    const uploader = new MediaUploader({
      db,
      me: ME_ID,
      api: {
        ...api(),
        sendChunk: async () => {
          calls += 1;
          throw new ApiClientError(500, 'broken');
        },
      } as unknown as MediaApi,
      outbox,
      retryBaseMs: 1,
    });
    await uploader.run();
    await vi.waitFor(async () => expect((await onlyRow())?.status).toBe('failed'));
    expect(calls).toBe(3);
    logged.mockRestore();
  });

  it('starts over if the server no longer has the upload', async () => {
    const { outbox, uploader } = build();
    await enqueue(outbox);
    failNext = new ApiClientError(404, 'gone');
    await uploader.run();
    await vi.waitFor(() => expect(server.created).toBe(2));
    await vi.waitFor(() => expect(sent).toHaveLength(1));
  });

  it('retrying a failed one goes through again', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { outbox, uploader } = build();
    const id = await enqueue(outbox);
    failNext = new ApiClientError(415, 'Not allowed');
    await uploader.run();
    await vi.waitFor(async () => expect((await onlyRow())?.status).toBe('failed'));
    await outbox.retry(id);
    await uploader.run();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    logged.mockRestore();
  });

  it('cancelling removes the message and its file, and stops the upload', async () => {
    const { outbox, uploader } = build();
    const id = await enqueue(outbox);
    uploader.cancel(id);
    expect(await outbox.cancel(id)).toBeUndefined();
    expect(await db.messages.count()).toBe(0);
    expect(await db.files.count()).toBe(0);
    await uploader.run();
    expect(server.created).toBe(0);
  });

  it('a row whose file is gone fails rather than hanging', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { outbox, uploader } = build();
    await enqueue(outbox);
    await db.files.clear();
    await uploader.run();
    await vi.waitFor(async () => expect((await onlyRow())?.status).toBe('failed'));
    logged.mockRestore();
  });
});
