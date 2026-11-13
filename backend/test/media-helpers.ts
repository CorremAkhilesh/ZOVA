import { randomBytes } from 'node:crypto';
import { uploadStateSchema } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import sharp from 'sharp';
import { expect } from 'vitest';
import { headers } from './auth-helpers.ts';
import type { signedIn } from './realtime-helpers.ts';

type Person = Awaited<ReturnType<typeof signedIn>>;

export const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), randomBytes(2000)]);
export const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(62), Buffer.alloc(200, 1)]);

export const png = () =>
  sharp({ create: { width: 3000, height: 1000, channels: 4, background: '#14B8A600' } })
    .png()
    .toBuffer();

/** The upload protocol as a client uses it. */
export function mediaClient(app: FastifyInstance) {
  const start = (who: Person, body: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: '/v1/uploads',
      headers: headers(who.cookie),
      payload: body,
    });
  const chunk = (who: Person, id: string, offset: number, bytes: Uint8Array) =>
    app.inject({
      method: 'PATCH',
      url: `/v1/uploads/${id}`,
      headers: {
        ...headers(who.cookie),
        'content-type': 'application/offset+octet-stream',
        'upload-offset': String(offset),
      },
      payload: Buffer.from(bytes),
    });
  const complete = (who: Person, id: string) =>
    app.inject({
      method: 'POST',
      url: `/v1/uploads/${id}/complete`,
      headers: headers(who.cookie),
    });
  /** A whole upload in one chunk. */
  const upload = async (who: Person, kind: string, name: string, bytes: Uint8Array) => {
    const started = await start(who, { kind, name, mime: 'x/y', size: bytes.length });
    expect(started.statusCode).toBe(200);
    const { uploadId } = uploadStateSchema.parse(started.json());
    expect((await chunk(who, uploadId, 0, bytes)).statusCode).toBe(200);
    return { uploadId, response: await complete(who, uploadId) };
  };
  const ready = async (who: Person, kind: string, name: string, bytes: Uint8Array) => {
    const { uploadId, response } = await upload(who, kind, name, bytes);
    expect(response.statusCode).toBe(200);
    return uploadId;
  };
  const content = (
    who: Person | null,
    id: string,
    extra: Record<string, string> = {},
    query = '',
  ) =>
    app.inject({
      method: 'GET',
      url: `/v1/media/${id}/content${query}`,
      headers: { ...(who ? headers(who.cookie) : {}), ...extra },
    });
  return { start, chunk, complete, upload, ready, content };
}
