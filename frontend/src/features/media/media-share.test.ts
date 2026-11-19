import { Blob as NodeBlob } from 'node:buffer';
import type { MediaInfo } from '@zuvo/protocol';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyChats } from '@/features/sync/apply';
import { getUserDb, type LocalDb } from '@/features/sync/local-db';
import { Outbox } from '@/features/sync/outbox';
import { chatFixture, ME_ID } from '@/test/chat-fixtures';
import type { MediaApi } from './api';
import { MediaUploader } from './uploader';

const SIZE = 10;
let db: LocalDb;
let connected: boolean;
let sent: Array<Record<string, unknown>>;
let server: { offset: number; created: number; completed: number; chunks: number[] };
let failNext: Error | null;
/** Chats whose next send the server refuses. */
const refuse = new Set<string>();

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
      return {
        uploadId: '64b7f0c2a1b2c3d4e5f60718',
        offset: 0,
        size: SIZE,
        status: 'pending' as const,
      };
    },
    state: async () => ({
      uploadId: '64b7f0c2a1b2c3d4e5f60718',
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
        sent.push(payload as Record<string, unknown>);
        if (refuse.has(payload.chatId)) {
          refuse.delete(payload.chatId);
          return { ok: false, error: { code: 'FORBIDDEN', message: 'no', requestId: 'r' } };
        }
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

/** One file to three chats ("Share to Zuvo"). */
const share = (outbox: Outbox) =>
  outbox.enqueueMedia({
    chatId: 'c1',
    alsoTo: ['c2', 'c3'],
    caption: 'look',
    info,
    // jsdom's own Blob cannot be stored.
    file: new NodeBlob(['0123456789']) as unknown as Blob,
  });

beforeEach(async () => {
  db = getUserDb(ME_ID);
  await db.open();
  await applyChats(db, [chatFixture(), chatFixture({ id: 'c2' }), chatFixture({ id: 'c3' })]);
  connected = true;
  sent = [];
  failNext = null;
  server = { offset: 0, created: 0, completed: 0, chunks: [] };
});

describe('one file to several chats', () => {
  it('uploads once; every chat gets it by reference, each with the same progress', async () => {
    const { outbox, uploader } = build();
    await share(outbox);
    const rows = (await db.messages.toArray()).sort((a, b) => a.order - b.order);
    expect(rows.map((row) => row.chatId)).toEqual(['c1', 'c2', 'c3']);
    expect(rows.every((row) => row.status === 'pending')).toBe(true);

    await uploader.run();
    expect(server.created).toBe(1);
    expect(server.completed).toBe(1);
    await vi.waitFor(() => expect(sent).toHaveLength(3));
    expect(sent[0]).toMatchObject({ chatId: 'c1', mediaIds: ['m-1'], caption: 'look' });
    expect(sent[1]).toMatchObject({ chatId: 'c2', sharedMediaId: 'm-1', caption: 'look' });
    expect(sent[2]).toMatchObject({ chatId: 'c3', sharedMediaId: 'm-1' });
    expect(sent[1]).not.toHaveProperty('mediaIds');
    await vi.waitFor(async () =>
      expect((await db.messages.toArray()).every((row) => row.status === 'sent')).toBe(true),
    );
    expect(await db.outbox.count()).toBe(0);
  });

  it('a refused chat fails alone, and its retry sends again without uploading', async () => {
    refuse.add('c2');
    const { outbox, uploader } = build();
    await share(outbox);
    await uploader.run();
    await vi.waitFor(async () => {
      const status = Object.fromEntries(
        (await db.messages.toArray()).map((row) => [row.chatId, row.status]),
      );
      expect(status).toEqual({ c1: 'sent', c2: 'failed', c3: 'sent' });
    });
    const failed = (await db.messages.toArray()).find((row) => row.status === 'failed');
    await outbox.retry(failed?.clientMsgId ?? '');
    await uploader.run();
    await vi.waitFor(async () =>
      expect((await db.messages.toArray()).every((row) => row.status === 'sent')).toBe(true),
    );
    expect(server.created).toBe(1);
    expect(sent.filter((payload) => payload.chatId === 'c2')).toHaveLength(2);
    expect(sent.at(-1)).toMatchObject({ chatId: 'c2', sharedMediaId: 'm-1' });
  });

  it('the shared copies wait for the upload: they never upload themselves', async () => {
    connected = false;
    const { outbox, uploader } = build();
    await share(outbox);
    failNext = new Error('network');
    await uploader.run().catch(() => undefined);
    expect(server.created).toBeLessThanOrEqual(1);
    const waiting = await db.outbox.toArray();
    expect(waiting.filter((row) => row.shareOf)).toHaveLength(2);
    expect(waiting.every((row) => !row.mediaId)).toBe(true);
    expect(sent).toHaveLength(0);
  });
});
