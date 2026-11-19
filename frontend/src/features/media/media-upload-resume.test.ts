import { Blob as NodeBlob } from 'node:buffer';
import type { MediaInfo } from '@zuvo/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyChats } from '@/features/sync/apply';
import { getUserDb, type LocalDb } from '@/features/sync/local-db';
import { Outbox } from '@/features/sync/outbox';
import { ApiClientError } from '@/lib/api-client';
import { chatFixture, ME_ID } from '@/test/chat-fixtures';
import type { MediaApi } from './api';
import { isUploadId, MediaUploader } from './uploader';

// Production bug (2026-11-18): a photo stayed "Not sent" for good. Every retry asked the server
// about its saved upload with an empty id (GET /v1/uploads/ → 400), never started a new one, and
// the 400 marked it failed again. These tests keep each part of that from coming back.

const SIZE = 10;
const FRESH = '64b7f0c2a1b2c3d4e5f60718';
const SAVED = '64b7f0c2a1b2c3d4e5f60719';
let db: LocalDb;
let sent: unknown[];
let calls: { create: number; state: string[]; chunks: string[] };
let stateError: Error | null;
let chunkError: Error | null;

const info = { kind: 'image' as const, name: 'a.png', mime: 'image/png', size: SIZE };
const mediaInfo: MediaInfo = {
  ...info,
  id: 'm-1',
  width: null,
  height: null,
  duration: null,
  placeholder: null,
  hasThumbnail: false,
};

const api = {
  create: async () => {
    calls.create += 1;
    return { uploadId: FRESH, offset: 0, size: SIZE, status: 'pending' as const };
  },
  state: async (id: string) => {
    calls.state.push(id);
    if (stateError) throw stateError;
    return { uploadId: id, offset: 0, size: SIZE, status: 'pending' as const };
  },
  sendChunk: async (id: string, offset: number, chunk: Blob) => {
    calls.chunks.push(id);
    if (chunkError) throw chunkError;
    return offset + chunk.size;
  },
  setPoster: async () => ({ ok: true as const }),
  complete: async () => mediaInfo,
  cancel: async () => ({ ok: true as const }),
} as unknown as MediaApi;

function build() {
  const outbox = new Outbox({
    db,
    me: ME_ID,
    transport: {
      isConnected: () => true,
      send: async (payload) => {
        sent.push(payload);
        const data = { messageId: 'msg', seq: 1, createdAt: '2026-11-18T12:30:00.000Z' };
        return { ok: true, data: { ...data, duplicate: false } };
      },
    },
  });
  const uploader = new MediaUploader({ db, me: ME_ID, api, outbox, retryBaseMs: 1 });
  return { outbox, uploader };
}

async function queued(uploadId?: string) {
  const { outbox, uploader } = build();
  const file = new NodeBlob(['0123456789']) as unknown as Blob;
  const id = await outbox.enqueueMedia({ chatId: 'c1', caption: '', info, file });
  const row = await db.outbox.where('clientMsgId').equals(id).first();
  if (row?.n !== undefined) await db.outbox.update(row.n, { uploadId });
  return { id, outbox, uploader };
}

const message = async () => (await db.messages.toArray())[0];

beforeEach(async () => {
  db = getUserDb(ME_ID);
  await db.open();
  await applyChats(db, [chatFixture({ id: 'c1' })]);
  sent = [];
  calls = { create: 0, state: [], chunks: [] };
  stateError = null;
  chunkError = null;
});
afterEach(() => vi.restoreAllMocks());

describe('an upload id that is empty or missing', () => {
  it.each([
    ['empty', ''],
    ['missing', undefined],
    ['not an id', 'undefined'],
  ])('%s: starts a fresh upload and never asks about it', async (_label, saved) => {
    const { uploader } = await queued(saved);
    await uploader.run();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(calls.create).toBe(1);
    expect(calls.state).toEqual([]);
    expect(new Set(calls.chunks)).toEqual(new Set([FRESH]));
  });

  it('the stuck message from production goes through when retried', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { id, outbox, uploader } = await queued('');
    const row = await db.outbox.toCollection().first();
    if (row) await outbox.markFailed(row);
    expect((await message())?.status).toBe('failed');
    await outbox.retry(id);
    await uploader.run();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(calls.state).toEqual([]);
  });

  it('accepts only the 24-character ids the server makes', () => {
    expect(isUploadId(FRESH)).toBe(true);
    for (const bad of ['', undefined, null, 'undefined', 'u-1', FRESH.toUpperCase()]) {
      expect(isUploadId(bad)).toBe(false);
    }
  });
});

describe('resuming a saved upload', () => {
  it('carries on with it when the server has it', async () => {
    const { uploader } = await queued(SAVED);
    await uploader.run();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(calls.state).toEqual([SAVED]);
    expect(calls.create).toBe(0);
  });

  it.each([400, 404])('a %i drops it and starts one fresh upload instead', async (status) => {
    stateError = new ApiClientError(status, 'no');
    const { uploader } = await queued(SAVED);
    await uploader.run();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(calls.state).toEqual([SAVED]);
    expect(calls.create).toBe(1);
    expect((await db.outbox.toArray()).length).toBe(0);
  });

  it('a server that keeps losing uploads ends in Not sent, not an endless loop', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    stateError = new ApiClientError(404, 'gone');
    chunkError = new ApiClientError(404, 'gone');
    const { uploader } = await queued(SAVED);
    await uploader.run();
    await vi.waitFor(async () => expect((await message())?.status).toBe('failed'));
    const tries = calls.create;
    expect(tries).toBeLessThanOrEqual(3);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls.create).toBe(tries);
    expect(sent).toEqual([]);
  });
});

describe('a file that is no longer on this device', () => {
  it('is missing: says so (fileLost), without asking the server or trying again', async () => {
    const { uploader } = await queued(SAVED);
    await db.files.clear();
    await uploader.run();
    await vi.waitFor(async () =>
      expect(await message()).toMatchObject({ status: 'failed', failReason: 'fileLost' }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toEqual({ create: 0, state: [], chunks: [] });
  });

  it('cannot be read any more (a different size): the same', async () => {
    const { uploader } = await queued();
    const stored = await db.files.toCollection().first();
    if (stored) await db.files.put({ ...stored, file: new NodeBlob(['01']) as unknown as Blob });
    await uploader.run();
    await vi.waitFor(async () => expect((await message())?.failReason).toBe('fileLost'));
    expect(calls.create).toBe(0);
  });

  it('a retry with nothing left to send says so, instead of Not sent forever', async () => {
    const { id, outbox } = await queued();
    await db.outbox.clear();
    await db.messages.toCollection().modify({ status: 'failed' });
    await outbox.retry(id);
    expect(await message()).toMatchObject({ status: 'failed', failReason: 'fileLost' });
  });
});
