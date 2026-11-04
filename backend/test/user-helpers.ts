import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import sharp from 'sharp';
import { type UserDoc, usersModel } from '../src/users/user-record.ts';
import { headers, signIn } from './auth-helpers.ts';

/** Signs in through the real OTP flow and completes the profile (name + username). */
export async function signInWithProfile(
  app: FastifyInstance,
  email: string,
  profile: { displayName: string; username: string },
) {
  const { cookie, response } = await signIn(app, email);
  const id = response.json().user.id as string;
  await usersModel(app).updateOne(
    { _id: new Types.ObjectId(id) },
    {
      $set: {
        displayName: profile.displayName,
        username: profile.username,
        searchTerms: [...profile.displayName.toLowerCase().split(/\s+/), profile.username],
      },
    },
  );
  return { cookie, id };
}

/** Inserts a user directly (no session) — fast setup for search, admin and service tests. */
export async function insertUser(
  app: FastifyInstance,
  fields: Partial<UserDoc> & { email: string },
): Promise<string> {
  const now = new Date();
  const { insertedId } = await usersModel(app).collection.insertOne({
    emailVerified: true,
    name: fields.displayName ?? '',
    role: 'user',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...fields,
  });
  return insertedId.toString();
}

export function promote(app: FastifyInstance, email: string) {
  return usersModel(app).updateOne({ email }, { $set: { role: 'admin' } });
}

/** A multipart/form-data body with one "file" field. */
export function multipartFile(bytes: Buffer, filename = 'photo.jpg', type = 'image/jpeg') {
  const boundary = `----zuvo${Date.now().toString(16)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${type}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, bytes, tail]),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

export function uploadAvatar(app: FastifyInstance, cookie: string | undefined, bytes: Buffer) {
  const { payload, contentType } = multipartFile(bytes);
  return app.inject({
    method: 'POST',
    url: '/v1/me/avatar',
    headers: { ...headers(cookie), 'content-type': contentType },
    payload,
  });
}

/** A JPEG with EXIF (camera model + GPS-like orientation data), 800×600. */
export function jpegWithExif(): Promise<Buffer> {
  return sharp({
    create: { width: 800, height: 600, channels: 3, background: { r: 79, g: 70, b: 229 } },
  })
    .jpeg()
    .withExif({ IFD0: { Make: 'ZuvoCam', Model: 'Secret Model 9' } })
    .toBuffer();
}
