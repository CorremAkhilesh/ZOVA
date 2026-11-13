import { UPLOAD_CHUNK_MAX_BYTES } from '@zuvo/protocol';
import { heldByAnotherTab, heldFile, releaseFile } from '@/features/sync/held-files';
import type { LocalDb, OutboxRow, UploadFailReason } from '@/features/sync/local-db';
import type { Outbox } from '@/features/sync/outbox';
import { asBlob } from '@/features/sync/stored-bytes';
import { ApiClientError } from '@/lib/api-client';
import type { MediaApi } from './api';

const CHUNK_BYTES = 4 * 1024 * 1024;
const LARGE_FILE_BYTES = 100 * 1024 * 1024;
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 2000;

/** Smaller chunks lose less on a bad link. A large file would need too many of them. */
export const chunkSizeFor = (fileBytes: number) =>
  fileBytes > LARGE_FILE_BYTES ? UPLOAD_CHUNK_MAX_BYTES : CHUNK_BYTES;

class FileLostError extends Error {}

/** Failures that trying again by itself cannot fix, and that the person should hear about. */
function failReasonOf(error: unknown): UploadFailReason | undefined {
  if (error instanceof FileLostError) return 'fileLost';
  if (!(error instanceof ApiClientError)) return undefined;
  if (error.apiError?.code === 'STORAGE_FULL') return 'diskFull';
  if (error.apiError?.code === 'PAYLOAD_TOO_LARGE') return 'overLimit';
  return undefined;
}

interface UploaderOptions {
  db: LocalDb;
  me: string;
  api: MediaApi;
  outbox: Pick<Outbox, 'resume' | 'markFailed' | 'leaderGrace'>;
  isOnline?: () => boolean;
  retryBaseMs?: number;
  chunkBytes?: number;
}

/**
 * Moves files from IndexedDB to the server, one at a time, in chunks. Progress is stored after every
 * chunk and the server knows its own offset, so a reload or lost connection carries on where it
 * stopped. Once the file is in, the outbox sends the message that uses it.
 */
export class MediaUploader {
  private readonly options: UploaderOptions;
  private running = false;
  private again = false;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private current: { clientMsgId: string; abort: AbortController } | null = null;

  constructor(options: UploaderOptions) {
    this.options = options;
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.timer);
    this.current?.abort.abort();
  }

  /** Stops the file in flight if it is this one. Its row is being removed. */
  cancel(clientMsgId: string): void {
    if (this.current?.clientMsgId === clientMsgId) this.current.abort.abort();
  }

  async run(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.again = false;
        await this.drain();
      } while (this.again && !this.stopped);
    } catch (error) {
      if (!this.stopped) {
        console.error(`[upload] stopped: ${error instanceof Error ? error.name : 'unknown'}`);
        this.later(RETRY_BASE_MS);
      }
    } finally {
      this.running = false;
    }
  }

  private later(ms: number) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), ms);
  }

  private async drain() {
    const { db, outbox, isOnline } = this.options;
    while (!this.stopped) {
      if (isOnline?.() === false) return;
      const row = await this.nextUpload(await db.outbox.where('state').equals('pending').toArray());
      if (!row) return;
      // Only this tab can send a file it holds, leader or not.
      const grace = heldFile(row.clientMsgId) ? 0 : outbox.leaderGrace(row);
      if (grace > 0) {
        this.later(grace);
        return;
      }
      if (!(await this.uploadOne(row))) return;
    }
  }

  /** The first file this tab can upload. One whose tab has closed is gone, and is marked so. */
  private async nextUpload(rows: OutboxRow[]): Promise<OutboxRow | undefined> {
    for (const row of rows) {
      if (!row.media || row.mediaId) continue;
      if (!row.heldInTab || heldFile(row.clientMsgId)) return row;
      if (!(await heldByAnotherTab(row.clientMsgId))) {
        await this.options.outbox.markFailed(row, 'fileLost');
      }
    }
    return undefined;
  }

  /** False means stop for now: no connection, or a failure to wait out. */
  private async uploadOne(row: OutboxRow): Promise<boolean> {
    const abort = new AbortController();
    this.current = { clientMsgId: row.clientMsgId, abort };
    try {
      await this.transfer(row, abort.signal);
      this.options.outbox.resume();
      return true;
    } catch (error) {
      if (abort.signal.aborted) return true;
      return this.handleFailure(row, error);
    } finally {
      this.current = null;
    }
  }

  private async handleFailure(row: OutboxRow, error: unknown): Promise<boolean> {
    const { db, outbox, retryBaseMs = RETRY_BASE_MS } = this.options;
    const reason = failReasonOf(error);
    if (reason) {
      await outbox.markFailed(row, reason);
      return true;
    }
    const status = error instanceof ApiClientError ? error.status : -1;
    if (status === 401) return false;
    if (status === 0) {
      // No connection. Not a failure: the next connect or `online` event carries on.
      this.later(retryBaseMs * 2);
      return false;
    }
    if (status === 404) {
      // The server no longer has it (cleaned up, or a different environment): start over.
      if (row.n !== undefined) await db.outbox.update(row.n, { uploadId: undefined });
      this.later(retryBaseMs);
      return false;
    }
    if (status === 429) {
      this.later(retryBaseMs * 3);
      return false;
    }
    const permanent = status >= 400 && status < 500;
    const attempts = row.attempts + 1;
    if (permanent || attempts >= MAX_ATTEMPTS) {
      console.error(`[upload] failed: ${error instanceof Error ? error.message : 'unknown'}`);
      await outbox.markFailed(row);
      return true;
    }
    if (row.n !== undefined) await db.outbox.update(row.n, { attempts });
    this.later(retryBaseMs * 2 ** (attempts - 1));
    return false;
  }

  private async transfer(row: OutboxRow, signal: AbortSignal) {
    const { db, me, api } = this.options;
    const stored = heldFile(row.clientMsgId) ?? (await db.files.get(row.clientMsgId));
    const info = row.media;
    if (!stored || !info || row.n === undefined) {
      throw new FileLostError('The file is no longer on this device');
    }
    const chunkBytes = this.options.chunkBytes ?? chunkSizeFor(info.size);
    const key = `${me}:${row.clientMsgId}`;
    const uploadId = await this.ensureUpload(row, stored.poster && asBlob(stored.poster));
    const file = asBlob(stored.file);
    let { offset } = await api.state(uploadId);
    while (offset < info.size) {
      if (signal.aborted) return;
      const chunk = file.slice(offset, offset + chunkBytes);
      offset = await api.sendChunk(uploadId, offset, chunk, signal);
      await db.transaction('rw', db.outbox, db.messages, async () => {
        // Also tells other tabs that this one is still at it.
        if (row.n !== undefined) await db.outbox.update(row.n, { queuedAt: Date.now() });
        await db.messages.update(key, { uploadedBytes: offset });
      });
    }
    const media = await api.complete(uploadId);
    await db.transaction('rw', db.outbox, db.messages, async () => {
      if (row.n !== undefined) {
        await db.outbox.update(row.n, { mediaId: media.id, heldInTab: false });
      }
      await db.messages.update(key, { media, heldInTab: false });
    });
    releaseFile(row.clientMsgId);
  }

  private async ensureUpload(row: OutboxRow, poster: Blob | undefined): Promise<string> {
    const { db, api } = this.options;
    if (row.uploadId) return row.uploadId;
    const info = row.media;
    if (!info || row.n === undefined) throw new Error('Nothing to upload');
    const { uploadId } = await api.create(info);
    await db.outbox.update(row.n, { uploadId });
    if (poster) await api.setPoster(uploadId, poster);
    return uploadId;
  }
}
