import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTempDir } from '../../test/helpers.ts';
import { StorageError } from './driver.ts';
import { isValidKey } from './keys.ts';
import { LocalDiskDriver } from './local-disk-driver.ts';

let root: Awaited<ReturnType<typeof makeTempDir>>;
let driver: LocalDiskDriver;

beforeEach(async () => {
  root = await makeTempDir('storage');
  driver = new LocalDiskDriver(root.path);
});
afterEach(() => root.cleanup());

const save = (content: string) => driver.save(Readable.from([Buffer.from(content)]));

describe('LocalDiskDriver', () => {
  it('saves a stream under a random sharded key and reads it back', async () => {
    const { key, size } = await save('hello world');
    expect(isValidKey(key)).toBe(true);
    expect(size).toBe(11);
    expect(await text(await driver.read(key))).toBe('hello world');

    const [shard1, shard2, id] = key.split('/');
    expect(id?.startsWith(`${shard1}${shard2}`)).toBe(true);
  });

  it('generates a different key for every save', async () => {
    const a = await save('same');
    const b = await save('same');
    expect(a.key).not.toBe(b.key);
  });

  it('reads an inclusive byte range', async () => {
    const { key } = await save('0123456789');
    expect(await text(await driver.read(key, { start: 2, end: 5 }))).toBe('2345');
    expect(await text(await driver.read(key, { start: 9, end: 9 }))).toBe('9');
  });

  it('rejects ranges outside the object', async () => {
    const { key } = await save('0123456789');
    await expect(driver.read(key, { start: 5, end: 10 })).rejects.toMatchObject({
      code: 'INVALID_RANGE',
    });
    await expect(driver.read(key, { start: 6, end: 5 })).rejects.toMatchObject({
      code: 'INVALID_RANGE',
    });
  });

  it('reports stat and exists, and deletes idempotently', async () => {
    const { key } = await save('abc');
    expect(await driver.exists(key)).toBe(true);
    expect(await driver.stat(key)).toMatchObject({ size: 3 });

    await driver.delete(key);
    await driver.delete(key);
    expect(await driver.exists(key)).toBe(false);
    expect(await driver.stat(key)).toBeNull();
    await expect(driver.read(key)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('enforces maxBytes and leaves no partial files behind', async () => {
    const big = Readable.from([Buffer.alloc(600), Buffer.alloc(600)]);
    await expect(driver.save(big, { maxBytes: 1000 })).rejects.toMatchObject({ code: 'TOO_LARGE' });
    expect(await readdir(join(root.path, '.tmp'))).toEqual([]);
    expect((await readdir(root.path)).filter((name) => name !== '.tmp')).toEqual([]);
  });

  it.each([
    '../../etc/passwd',
    '..\\..\\windows\\win.ini',
    'ab/cd/../../../../secret',
    '/etc/passwd',
    'C:\\Windows\\win.ini',
    'ab/cd/ABCDEF0123456789ABCDEF0123456789',
    'ab/cd/0123',
    '',
  ])('rejects the unsafe or malformed key %j', async (key) => {
    await expect(driver.read(key)).rejects.toBeInstanceOf(StorageError);
    await expect(driver.stat(key)).rejects.toMatchObject({ code: 'INVALID_KEY' });
    await expect(driver.delete(key)).rejects.toMatchObject({ code: 'INVALID_KEY' });
  });

  it('passes the writability check on a writable folder', async () => {
    await expect(driver.checkWritable()).resolves.toBeUndefined();
  });
});
