import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { type Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AppError } from '../lib/errors.ts';

/**
 * Where files wait while being uploaded: next to the storage, under a name only the server chooses
 * (the media id). The StorageDriver receives them once checked, so another driver can replace disk
 * without changing the upload protocol.
 */
export class UploadArea {
  private readonly root: string;

  constructor(storagePath: string) {
    this.root = join(storagePath, '.uploads');
  }

  /** `id` is always an ObjectId the server created, never user input. */
  pathFor(id: string): string {
    return join(this.root, id);
  }

  /** Bytes received so far. A chunk cut off midway still counts: the client continues from here. */
  async offset(id: string): Promise<number> {
    try {
      return (await stat(this.pathFor(id))).size;
    } catch {
      return 0;
    }
  }

  /**
   * Appends up to `maxBytes`. Anything past that is read and dropped rather than cutting the
   * connection, so the client gets a proper answer. Returns the new offset.
   */
  async append(id: string, input: Readable, maxBytes: number): Promise<number> {
    await mkdir(this.root, { recursive: true });
    let written = 0;
    let tooLong = false;
    const limit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        written += chunk.length;
        if (written > maxBytes) {
          tooLong = true;
          callback();
          return;
        }
        callback(null, chunk);
      },
    });
    try {
      await pipeline(input, limit, createWriteStream(this.pathFor(id), { flags: 'a' }));
    } catch {
      // The connection dropped mid-chunk: what arrived is kept and the client resumes after it.
    }
    if (tooLong)
      throw new AppError('PAYLOAD_TOO_LARGE', 'This chunk goes past the end of the file.');
    return this.offset(id);
  }

  async readHead(id: string, bytes: number): Promise<Uint8Array> {
    const file = await open(this.pathFor(id), 'r');
    try {
      const buffer = Buffer.alloc(bytes);
      const { bytesRead } = await file.read(buffer, 0, bytes, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await file.close();
    }
  }

  read(id: string): Readable {
    return createReadStream(this.pathFor(id));
  }

  async remove(id: string): Promise<void> {
    await rm(this.pathFor(id), { force: true });
  }
}
