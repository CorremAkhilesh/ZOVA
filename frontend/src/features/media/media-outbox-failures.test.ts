import { Blob as NodeBlob } from 'node:buffer';
import type { MediaInfo } from '@zuvo/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyChats } from '@/features/sync/apply';
import { getUserDb, type LocalDb } from '@/features/sync/local-db';
import { Outbox } from '@/features/sync/outbox';
import { ApiClientError } from '@/lib/api-client';
import { chatFixture, ME_ID } from '@/test/chat-fixtures';
import type { MediaApi } from './api';
import { MediaUploader } from './uploader';

const SIZE = 10;
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

describe('browsers that cannot keep a Blob in IndexedDB', () => {
  it('keeps the file’s bytes instead, and uploads them just the same', async () => {
    // Safari's private windows refuse Blobs; a fresh database means it is asked again.
    const refused = vi.spyOn(db.files, 'put').mockRejectedValueOnce(new Error('refused'));
    const { outbox, uploader } = build();
    await enqueue(outbox);
    refused.mockRestore();
    const stored = await db.files.toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.file).not.toHaveProperty('slice');
    expect(stored[0]?.file).toHaveProperty('type');

    await uploader.run();
    expect(server.chunks).toEqual([0, 4, 8]);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
  });
});
