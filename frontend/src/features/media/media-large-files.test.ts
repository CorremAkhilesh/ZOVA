import { Blob as NodeBlob } from 'node:buffer';
import type { MediaInfo } from '@zuvo/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyChats } from '@/features/sync/apply';
import { heldFile, releaseAllFiles, releaseFile } from '@/features/sync/held-files';
import { getUserDb, type LocalDb } from '@/features/sync/local-db';
import { Outbox } from '@/features/sync/outbox';
import { isQuotaError } from '@/features/sync/stored-bytes';
import { ApiClientError } from '@/lib/api-client';
import { chatFixture, ME_ID } from '@/test/chat-fixtures';
import type { MediaApi } from './api';
import { withTimeout } from './process';
import { chunkSizeFor, MediaUploader } from './uploader';

const MB = 1024 * 1024;
const SIZE = 10;
const info = { kind: 'document' as const, name: 'a.pdf', mime: 'application/pdf', size: SIZE };
const mediaInfo: MediaInfo = {
  ...info,
  id: 'm-1',
  width: null,
  height: null,
  duration: null,
  placeholder: null,
  hasThumbnail: false,
};

let db: LocalDb;
let sent: unknown[];
let created: number;
let received: number;
let refuseWith: ApiClientError | null;

const refusal = (status: number, code: string) =>
  new ApiClientError(status, 'refused', { code, message: 'refused', requestId: 'r' } as never);

const api = () =>
  ({
    create: async () => {
      if (refuseWith) throw refuseWith;
      created += 1;
      return { uploadId: 'u-1', offset: 0, size: SIZE, status: 'pending' as const };
    },
    state: async () => ({ uploadId: 'u-1', offset: received, size: SIZE, status: 'pending' }),
    sendChunk: async (_id: string, offset: number, chunk: Blob) => {
      received = offset + chunk.size;
      return received;
    },
    setPoster: async () => ({ ok: true as const }),
    complete: async () => mediaInfo,
    cancel: async () => ({ ok: true as const }),
  }) as unknown as MediaApi;

function build(isLeader = true) {
  const outbox = new Outbox({
    db,
    me: ME_ID,
    isLeader: () => isLeader,
    takeoverMs: 60_000,
    transport: {
      isConnected: () => true,
      send: async (payload) => {
        sent.push(payload);
        return {
          ok: true,
          data: {
            messageId: 'msg',
            seq: 1,
            createdAt: '2026-11-05T10:00:00.000Z',
            duplicate: false,
          },
        };
      },
    },
  });
  const uploader = new MediaUploader({ db, me: ME_ID, api: api(), outbox, chunkBytes: 4 });
  return { outbox, uploader };
}

// jsdom's own Blob cannot be stored.
const file = () => new NodeBlob(['0123456789']) as unknown as Blob;
const enqueue = (outbox: Outbox, blob = file()) =>
  outbox.enqueueMedia({ chatId: 'c1', caption: '', info, file: blob });
const onlyMessage = async () => (await db.messages.toArray())[0];

function storageEstimate(estimate: { quota?: number; usage?: number }) {
  vi.stubGlobal('navigator', {
    ...navigator,
    storage: { estimate: async () => estimate },
  });
}

function otherTabHolds(id: string) {
  vi.stubGlobal('navigator', {
    ...navigator,
    locks: {
      request: () => Promise.resolve(),
      query: async () => ({ held: [{ name: `zuvo-held-file:${id}` }], pending: [] }),
    },
  });
}

beforeEach(async () => {
  db = getUserDb(ME_ID);
  await db.open();
  await applyChats(db, [chatFixture()]);
  sent = [];
  created = 0;
  received = 0;
  refuseWith = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
  releaseAllFiles();
});

describe('when the browser has room', () => {
  it('keeps the file for a resumable upload and says nothing', async () => {
    storageEstimate({ quota: 1000 * MB, usage: 0 });
    const { outbox } = build();
    const id = await enqueue(outbox);
    expect(await db.files.get(id)).toBeDefined();
    expect(heldFile(id)).toBeUndefined();
    expect((await onlyMessage())?.heldInTab).toBeUndefined();
  });

  it('keeps it when the browser cannot say how much room there is', async () => {
    const { outbox } = build();
    const id = await enqueue(outbox);
    expect(await db.files.get(id)).toBeDefined();
  });
});

describe('when the browser has no room', () => {
  const lowQuota = () => storageEstimate({ quota: 100, usage: 100 });

  it('still uploads, from this tab, and tells the person to keep it open', async () => {
    lowQuota();
    const { outbox, uploader } = build();
    const id = await enqueue(outbox);
    expect(await db.files.count()).toBe(0);
    expect(heldFile(id)).toBeDefined();
    expect(await onlyMessage()).toMatchObject({ status: 'pending', heldInTab: true });

    await uploader.run();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(received).toBe(SIZE);
    expect(heldFile(id)).toBeUndefined();
    expect((await onlyMessage())?.heldInTab).toBe(false);
  });

  it('allows for the margin: a file that only just fits is not kept', async () => {
    storageEstimate({ quota: SIZE, usage: 0 });
    const { outbox } = build();
    const id = await enqueue(outbox);
    expect(heldFile(id)).toBeDefined();
  });

  it('falls back the same way if the browser refuses the write', async () => {
    const full = Object.assign(new Error('full'), { name: 'QuotaExceededError' });
    const add = vi.spyOn(db.files, 'add').mockRejectedValueOnce(full);
    const { outbox } = build();
    const id = await enqueue(outbox);
    add.mockRestore();
    expect(heldFile(id)).toBeDefined();
    expect(await db.outbox.count()).toBe(1);
    expect(await db.messages.count()).toBe(1);
  });

  it('never loads a large file into memory for a browser that refuses Blobs', async () => {
    const refused = vi.spyOn(db.files, 'put').mockRejectedValueOnce(new Error('refused'));
    const big = file();
    Object.defineProperty(big, 'size', { value: 500 * MB });
    const read = vi.spyOn(big, 'arrayBuffer');
    const { outbox } = build();
    const id = await enqueue(outbox, big);
    refused.mockRestore();
    expect(read).not.toHaveBeenCalled();
    expect(heldFile(id)).toBeDefined();
  });

  it('shows other storage failures instead of hiding them', async () => {
    const add = vi.spyOn(db.files, 'add').mockRejectedValueOnce(new Error('broken'));
    const { outbox } = build();
    await expect(enqueue(outbox)).rejects.toThrow();
    add.mockRestore();
    expect(await db.messages.count()).toBe(0);
  });

  it('uploads from a tab that is not the leader, because only it has the file', async () => {
    lowQuota();
    const { outbox, uploader } = build(false);
    await enqueue(outbox);
    await uploader.run();
    expect(received).toBe(SIZE);
  });

  it('lets go of the file when the upload is cancelled', async () => {
    lowQuota();
    const { outbox } = build();
    const id = await enqueue(outbox);
    await outbox.cancel(id);
    expect(heldFile(id)).toBeUndefined();
  });
});

describe('when the tab holding the file has gone', () => {
  const heldThenGone = async (outbox: Outbox) => {
    storageEstimate({ quota: 100, usage: 100 });
    const id = await enqueue(outbox);
    releaseFile(id);
    return id;
  };

  it('says the file is lost, rather than waiting forever', async () => {
    const { outbox, uploader } = build();
    await heldThenGone(outbox);
    await uploader.run();
    expect(created).toBe(0);
    expect(await onlyMessage()).toMatchObject({ status: 'failed', failReason: 'fileLost' });
  });

  it('leaves it alone while another tab still has it', async () => {
    const { outbox, uploader } = build();
    const id = await heldThenGone(outbox);
    otherTabHolds(id);
    await uploader.run();
    expect(created).toBe(0);
    expect((await onlyMessage())?.status).toBe('pending');
  });

  it('can be removed', async () => {
    const { outbox, uploader } = build();
    const id = await heldThenGone(outbox);
    await uploader.run();
    await outbox.cancel(id);
    expect(await db.messages.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });
});

describe('when the server refuses', () => {
  it('says the disk is full, at once, and a retry clears it', async () => {
    refuseWith = refusal(507, 'STORAGE_FULL');
    const { outbox, uploader } = build();
    const id = await enqueue(outbox);
    await uploader.run();
    expect(await onlyMessage()).toMatchObject({ status: 'failed', failReason: 'diskFull' });

    refuseWith = null;
    await outbox.retry(id);
    expect((await onlyMessage())?.failReason).toBeUndefined();
    await uploader.run();
    await vi.waitFor(() => expect(sent).toHaveLength(1));
  });

  it('says the file is over the limit', async () => {
    refuseWith = refusal(413, 'PAYLOAD_TOO_LARGE');
    const { outbox, uploader } = build();
    await enqueue(outbox);
    await uploader.run();
    expect(await onlyMessage()).toMatchObject({ status: 'failed', failReason: 'overLimit' });
  });
});

describe('helpers', () => {
  it('uses larger chunks only for large files', () => {
    expect(chunkSizeFor(100 * MB)).toBe(4 * MB);
    expect(chunkSizeFor(100 * MB + 1)).toBe(8 * MB);
    expect(chunkSizeFor(1024 * MB)).toBe(8 * MB);
  });

  it('recognises a full store, directly or as the reason for an abort', () => {
    expect(isQuotaError(Object.assign(new Error('x'), { name: 'QuotaExceededError' }))).toBe(true);
    const inner = { name: 'QuotaExceededError' };
    expect(isQuotaError(Object.assign(new Error('x'), { name: 'AbortError', inner }))).toBe(true);
    expect(isQuotaError(new Error('x'))).toBe(false);
    expect(isQuotaError('x')).toBe(false);
  });

  it('gives up on work that takes too long', async () => {
    await expect(withTimeout(new Promise(() => {}), 1)).rejects.toThrow('Timed out');
    await expect(withTimeout(Promise.resolve('done'), 1000)).resolves.toBe('done');
  });
});
