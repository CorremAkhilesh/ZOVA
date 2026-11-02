import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { type Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  type ByteRange,
  type ObjectStat,
  type SaveOptions,
  type StorageDriver,
  StorageError,
  type StoredObject,
} from './driver.ts';
import { generateKey, isValidKey } from './keys.ts';

const TEMP_DIR = '.tmp';

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/** Stores media as files under `root`, e.g. `<root>/ab/cd/abcd…`. */
export class LocalDiskDriver implements StorageDriver {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async save(input: Readable, options: SaveOptions = {}): Promise<StoredObject> {
    const key = generateKey();
    const tempPath = join(this.root, TEMP_DIR, randomUUID());
    await mkdir(dirname(tempPath), { recursive: true });

    let size = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (options.maxBytes !== undefined && size > options.maxBytes) {
          callback(new StorageError('TOO_LARGE', `File exceeds ${options.maxBytes} bytes`));
          return;
        }
        callback(null, chunk);
      },
    });

    try {
      await pipeline(input, counter, createWriteStream(tempPath, { flags: 'wx' }));
      const finalPath = this.pathFor(key);
      await mkdir(dirname(finalPath), { recursive: true });
      await rename(tempPath, finalPath);
    } catch (error) {
      await rm(tempPath, { force: true });
      throw error;
    }
    return { key, size };
  }

  async read(key: string, range?: ByteRange): Promise<Readable> {
    const path = this.pathFor(key);
    const info = await this.stat(key);
    if (!info) throw new StorageError('NOT_FOUND', 'Object not found');
    if (range && (range.start < 0 || range.start > range.end || range.end >= info.size)) {
      throw new StorageError('INVALID_RANGE', 'Range is outside the object');
    }
    return createReadStream(path, range ? { start: range.start, end: range.end } : {});
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    return (await this.stat(key)) !== null;
  }

  async stat(key: string): Promise<ObjectStat | null> {
    try {
      const info = await stat(this.pathFor(key));
      return info.isFile() ? { size: info.size, modifiedAt: info.mtime } : null;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async checkWritable(): Promise<void> {
    const probe = join(this.root, TEMP_DIR, `probe-${randomUUID()}`);
    await mkdir(dirname(probe), { recursive: true });
    await writeFile(probe, 'ok');
    await rm(probe, { force: true });
  }

  /** Resolves a key to a path, rejecting anything that is not a well-formed key inside root. */
  private pathFor(key: string): string {
    if (!isValidKey(key)) throw new StorageError('INVALID_KEY', 'Invalid storage key');
    const path = resolve(this.root, ...key.split('/'));
    if (!path.startsWith(this.root + sep)) {
      throw new StorageError('INVALID_KEY', 'Invalid storage key');
    }
    return path;
  }
}
