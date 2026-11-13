import { mkdir, open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { adminUsersResponseSchema } from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { headers } from '../../../test/auth-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { mediaClient, PDF } from '../../../test/media-helpers.ts';
import { signedIn } from '../../../test/realtime-helpers.ts';
import { chatModels, oid } from '../../chats/chats.service.ts';
import { ACTIVE_UPLOAD_MS, cleanupOrphans } from '../../media/media.service.ts';
import { UploadArea } from '../../media/upload-area.ts';
import { CHUNK_RATE_LIMIT } from './media.routes.ts';

const MB = 1024 * 1024;
const GB = 1024 * MB;

type Person = Awaited<ReturnType<typeof signedIn>>;

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const client = () => mediaClient(app());
let people = 0;
const person = () => {
  people += 1;
  return signedIn(app(), `limits${people}@corremadvisory.com`);
};
const doc = (size: number, kind = 'document') => ({
  kind,
  name: 'big.pdf',
  mime: 'application/pdf',
  size,
});

beforeAll(async () => {
  built = await buildTestApp();
});
afterAll(() => built.cleanup());

describe('the size limit at 1 GB', () => {
  it.each([
    ['just under', GB - 1],
    ['exactly at', GB],
  ])('accepts a document %s the limit', async (_label, size) => {
    const response = await client().start(await person(), doc(size));
    expect(response.statusCode).toBe(200);
    expect(response.json().size).toBe(size);
  });

  it('accepts a video at the limit', async () => {
    const response = await client().start(await person(), doc(GB, 'video'));
    expect(response.statusCode).toBe(200);
  });

  it.each(['document', 'video'])('refuses a %s one byte over, before bytes move', async (kind) => {
    const response = await client().start(await person(), doc(GB + 1, kind));
    expect(response.statusCode).toBe(413);
    expect(response.json()).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      details: { maxBytes: GB },
    });
  });

  it('keeps pictures at 100 MB', async () => {
    const who = await person();
    expect((await client().start(who, doc(100 * MB, 'image'))).statusCode).toBe(200);
    expect((await client().start(who, doc(100 * MB + 1, 'image'))).statusCode).toBe(413);
  });

  it('takes the last bytes of a 1 GB file, and no more', async () => {
    const who = await person();
    const { uploadId } = (await client().start(who, doc(GB))).json();
    // Empty space instead of a real gigabyte: only the end of the file matters here.
    const path = new UploadArea(built.env.MEDIA_STORAGE_PATH).pathFor(uploadId);
    await mkdir(dirname(path), { recursive: true });
    const file = await open(path, 'w');
    await file.truncate(GB - 5);
    await file.close();

    const tooMany = await client().chunk(who, uploadId, GB - 5, Buffer.alloc(6, 1));
    expect(tooMany.statusCode).toBe(413);

    const state = await app().inject({
      method: 'GET',
      url: `/v1/uploads/${uploadId}`,
      headers: headers(who.cookie),
    });
    const { offset } = state.json();
    const rest = await client().chunk(who, uploadId, offset, Buffer.alloc(GB - offset, 1));
    expect(rest.statusCode).toBe(200);
    expect(rest.json().offset).toBe(GB);

    await app().inject({
      method: 'DELETE',
      url: `/v1/uploads/${uploadId}`,
      headers: headers(who.cookie),
    });
  });

  it('gives chunks a limit of their own, far above the general one', async () => {
    const who = await person();
    const { uploadId } = (await client().start(who, doc(10))).json();
    const response = await app().inject({
      method: 'PATCH',
      url: `/v1/uploads/${uploadId}`,
      remoteAddress: '10.20.30.40',
      headers: {
        ...headers(who.cookie),
        'content-type': 'application/offset+octet-stream',
        'upload-offset': '0',
      },
      payload: Buffer.alloc(1),
    });
    expect(response.headers['x-ratelimit-limit']).toBe(String(CHUNK_RATE_LIMIT.max));
  });
});

describe('a different configured limit', () => {
  it('moves the boundary', async () => {
    const small = await buildTestApp({}, { MEDIA_MAX_FILE_MB: '5' });
    try {
      const api = mediaClient(small.app);
      const who = await signedIn(small.app, 'small@corremadvisory.com');
      expect((await api.start(who, doc(5 * MB))).statusCode).toBe(200);
      const over = await api.start(who, doc(5 * MB + 1));
      expect(over.statusCode).toBe(413);
      expect(over.json().details.maxBytes).toBe(5 * MB);
    } finally {
      await small.cleanup();
    }
  });
});

describe('free disk space', () => {
  const disk = (space: { total: number; free: number } | null) =>
    vi.spyOn(app().storage, 'space').mockResolvedValue(space);

  it('refuses an upload that would take the disk past 90%, with a clear error', async () => {
    const who = await person();
    const space = disk({ total: 100 * GB, free: 10 * GB + 100 });
    const response = await client().start(who, doc(101));
    space.mockRestore();
    expect(response.statusCode).toBe(507);
    expect(response.json()).toMatchObject({ code: 'STORAGE_FULL' });
    expect(response.json().message).toContain('low on storage');
  });

  it('accepts one that takes it to exactly 90%', async () => {
    const who = await person();
    const space = disk({ total: 100 * GB, free: 10 * GB + 100 });
    const response = await client().start(who, doc(100));
    space.mockRestore();
    expect(response.statusCode).toBe(200);
  });

  it('stops an upload when the disk fills up on the way, and it can carry on later', async () => {
    const who = await person();
    const { uploadId } = (await client().start(who, doc(PDF.length))).json();

    const space = disk({ total: 100 * GB, free: 10 * GB });
    const refused = await client().chunk(who, uploadId, 0, PDF);
    space.mockRestore();
    expect(refused.statusCode).toBe(507);

    const later = await client().chunk(who, uploadId, 0, PDF);
    expect(later.statusCode).toBe(200);
    expect(later.json().offset).toBe(PDF.length);
  });

  it('carries on when there is no disk to ask about, or asking fails', async () => {
    const who = await person();
    const none = disk(null);
    expect((await client().start(who, doc(10))).statusCode).toBe(200);
    none.mockRestore();
    const broken = vi.spyOn(app().storage, 'space').mockRejectedValue(new Error('no statfs'));
    expect((await client().start(who, doc(10))).statusCode).toBe(200);
    broken.mockRestore();
  });
});

describe('finishing a large upload', () => {
  it('processes it once when the client asks twice', async () => {
    const who = await person();
    const { uploadId } = (await client().start(who, doc(PDF.length))).json();
    await client().chunk(who, uploadId, 0, PDF);
    const save = vi.spyOn(app().storage, 'save');
    const [first, second] = await Promise.all([
      client().complete(who, uploadId),
      client().complete(who, uploadId),
    ]);
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(second.json().media.id).toBe(first.json().media.id);
    expect(save).toHaveBeenCalledTimes(1);
    save.mockRestore();
  });
});

describe('Admin → Users', () => {
  const row = async (admin: Person, email: string) => {
    const response = await app().inject({
      method: 'GET',
      url: `/v1/admin/users?q=${encodeURIComponent(email)}`,
      headers: headers(admin.cookie),
    });
    return adminUsersResponseSchema.parse(response.json()).items[0];
  };

  it('shows what each person stores, counting only finished files', async () => {
    const admin = await signedIn(app(), 'admin@corremadvisory.com');
    const who = await person();
    const quiet = await person();
    await client().ready(who, 'document', 'a.pdf', PDF);
    await client().ready(who, 'document', 'b.pdf', PDF);
    await client().start(who, doc(GB));

    expect((await row(admin, who.email))?.storageBytes).toBe(PDF.length * 2);
    expect((await row(admin, quiet.email))?.storageBytes).toBe(0);
  });
});

describe('cleaning up old uploads', () => {
  it('leaves one still receiving bytes, and removes one that stopped', async () => {
    const who = await person();
    const { uploadId } = (await client().start(who, doc(PDF.length + 1))).json();
    await client().chunk(who, uploadId, 0, PDF);
    const { Media } = chatModels(app());
    await Media.updateOne({ _id: oid(uploadId) }, { $set: { createdAt: new Date(0) } });

    await cleanupOrphans(app(), new Date(Date.now() + ACTIVE_UPLOAD_MS / 2));
    expect(await Media.findById(uploadId).lean()).not.toBeNull();

    await cleanupOrphans(app(), new Date(Date.now() + ACTIVE_UPLOAD_MS + 60_000));
    expect(await Media.findById(uploadId).lean()).toBeNull();
    const area = new UploadArea(built.env.MEDIA_STORAGE_PATH);
    expect(await area.offset(uploadId)).toBe(0);
  });
});
