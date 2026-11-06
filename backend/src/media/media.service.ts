import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { type CreateUploadBody, type MediaInfo, UPLOAD_CHUNK_MAX_BYTES } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import type { ClientSession } from 'mongoose';
import { chatModels, oid } from '../chats/chats.service.ts';
import { canSeeSeq, requireParticipant } from '../chats/visibility.ts';
import type { MediaDoc } from '../db/chat-models.ts';
import { AppError } from '../lib/errors.ts';
import { assertRoomFor, assertWithinLimits } from './limits.ts';
import { processImage, processPoster } from './process-image.ts';
import { UploadArea } from './upload-area.ts';
import { SNIFF_BYTES, verifyFileType } from './validate.ts';

/** Uploads a person can have open at once, in the last hour. Abandoned ones stop counting. */
export const MAX_OPEN_UPLOADS = 5;
const OPEN_UPLOAD_WINDOW_MS = 3600_000;
export const UPLOADS_PER_MINUTE = 60;
export const ORPHAN_AGE_MS = 24 * 3600_000;
/** An old upload still receiving bytes is slow, not abandoned. */
export const ACTIVE_UPLOAD_MS = 3600_000;

const area = (app: FastifyInstance) => new UploadArea(app.env.MEDIA_STORAGE_PATH);

export function toMediaInfo(doc: MediaDoc): MediaInfo {
  return {
    id: doc._id.toString(),
    kind: doc.kind,
    mime: doc.mime,
    size: doc.size,
    name: doc.name,
    width: doc.width,
    height: doc.height,
    duration: doc.duration,
    waveform: doc.waveform ?? null,
    placeholder: doc.placeholder,
    hasThumbnail: doc.thumbnailKey !== null,
  };
}

/** An upload only its owner can touch. Anyone else gets the same answer as for no upload at all. */
async function ownUpload(app: FastifyInstance, userId: string, id: string): Promise<MediaDoc> {
  const doc = await chatModels(app)
    .Media.findOne({ _id: oid(id), ownerId: oid(userId) })
    .lean();
  if (!doc) throw new AppError('NOT_FOUND', 'Upload not found.');
  return doc;
}

export async function createUpload(app: FastifyInstance, userId: string, body: CreateUploadBody) {
  const { Media } = chatModels(app);
  const key = `zuvo:rate:upload:${userId}`;
  if ((await app.counterStore.increment(key, 60)) > UPLOADS_PER_MINUTE) {
    throw new AppError('RATE_LIMITED', 'Too many uploads. Try again in a minute.');
  }
  assertWithinLimits(app.env, body);
  await assertRoomFor(app, body.size);
  const open = await Media.countDocuments({
    ownerId: oid(userId),
    status: 'pending',
    createdAt: { $gt: new Date(Date.now() - OPEN_UPLOAD_WINDOW_MS) },
  });
  if (open >= MAX_OPEN_UPLOADS) {
    throw new AppError('RATE_LIMITED', 'Too many uploads at once. Wait for one to finish.');
  }
  const [doc] = await Media.insertMany([
    {
      ownerId: oid(userId),
      kind: body.kind,
      mime: body.mime,
      name: body.name,
      size: body.size,
      width: body.width ?? null,
      height: body.height ?? null,
      duration: body.duration ?? null,
      waveform: body.waveform ?? null,
    },
  ]);
  if (!doc) throw new AppError('INTERNAL_ERROR', 'Could not start the upload.');
  return { uploadId: doc._id.toString(), offset: 0, size: body.size, status: 'pending' as const };
}

export async function uploadState(app: FastifyInstance, userId: string, id: string) {
  const doc = await ownUpload(app, userId, id);
  const offset = doc.status === 'pending' ? await area(app).offset(id) : doc.size;
  return { uploadId: id, offset, size: doc.size, status: doc.status };
}

/** Only one chunk per upload at a time, or two writers could interleave. */
const writing = new Set<string>();

export async function appendChunk(
  app: FastifyInstance,
  userId: string,
  id: string,
  offset: number,
  chunk: Readable,
) {
  const doc = await ownUpload(app, userId, id);
  if (doc.status !== 'pending') throw new AppError('CONFLICT', 'This upload has finished.');
  const uploads = area(app);
  const current = await uploads.offset(id);
  if (writing.has(id) || current !== offset) {
    chunk.resume();
    throw new AppError('UPLOAD_OFFSET_MISMATCH', 'Continue from the offset the server has.', {
      offset: current,
    });
  }
  writing.add(id);
  try {
    await assertRoomFor(app, doc.size - current);
    const next = await uploads.append(
      id,
      chunk,
      Math.min(doc.size - current, UPLOAD_CHUNK_MAX_BYTES),
    );
    return { uploadId: id, offset: next, size: doc.size, status: doc.status };
  } catch (error) {
    chunk.resume();
    throw error;
  } finally {
    writing.delete(id);
  }
}

/** A video's poster frame, made by the browser. Validated as a real image and re-encoded. */
export async function setPoster(
  app: FastifyInstance,
  userId: string,
  id: string,
  bytes: Uint8Array,
) {
  const doc = await ownUpload(app, userId, id);
  if (doc.kind !== 'video' || doc.status !== 'pending') {
    throw new AppError('BAD_REQUEST', 'Only an unfinished video can take a poster.');
  }
  const { thumbnail, placeholder } = await processPoster(bytes);
  const { key } = await app.storage.save(Readable.from([thumbnail]));
  if (doc.thumbnailKey) await app.storage.delete(doc.thumbnailKey);
  await chatModels(app)
    .Media.updateOne({ _id: doc._id }, { $set: { thumbnailKey: key, placeholder } })
    .exec();
}

async function sha256Of(uploads: UploadArea, id: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(uploads.read(id), hash);
  return hash.digest('hex');
}

/** Hashing and storing a large file takes a while, and a client that lost the answer asks again. */
const completing = new Map<string, Promise<MediaInfo>>();

/** The upload is complete: checks the file, processes it and moves it into storage. */
export async function completeUpload(app: FastifyInstance, userId: string, id: string) {
  const doc = await ownUpload(app, userId, id);
  if (doc.status === 'ready') return toMediaInfo(doc);
  if (doc.status === 'failed') throw new AppError('CONFLICT', 'This upload has failed.');
  const running = completing.get(id);
  if (running) return running;
  const work = finishUpload(app, doc).finally(() => completing.delete(id));
  completing.set(id, work);
  return work;
}

async function finishUpload(app: FastifyInstance, doc: MediaDoc): Promise<MediaInfo> {
  const { Media } = chatModels(app);
  const id = doc._id.toString();
  const uploads = area(app);
  const received = await uploads.offset(id);
  if (received !== doc.size) {
    throw new AppError('UPLOAD_OFFSET_MISMATCH', 'The file is not complete yet.', {
      offset: received,
    });
  }
  try {
    const mime = await verifyFileType(doc.kind, doc.name, await uploads.readHead(id, SNIFF_BYTES));
    const sha256 = await sha256Of(uploads, id);
    const fields = await storeFile(app, uploads, doc);
    const updated = await Media.findByIdAndUpdate(
      doc._id,
      { $set: { ...fields, mime: fields.mime ?? mime, sha256, status: 'ready' } },
      { returnDocument: 'after' },
    ).lean();
    await uploads.remove(id);
    if (!updated) throw new AppError('NOT_FOUND', 'Upload not found.');
    return toMediaInfo(updated);
  } catch (error) {
    if (error instanceof AppError && error.code === 'UNSUPPORTED_MEDIA_TYPE') {
      await uploads.remove(id);
      if (doc.thumbnailKey) await app.storage.delete(doc.thumbnailKey);
      await Media.updateOne({ _id: doc._id }, { $set: { status: 'failed', thumbnailKey: null } });
    }
    throw error;
  }
}

async function storeFile(app: FastifyInstance, uploads: UploadArea, doc: MediaDoc) {
  const id = doc._id.toString();
  if (doc.kind !== 'image') {
    const { key } = await app.storage.save(uploads.read(id), { maxBytes: doc.size });
    return { storageKey: key };
  }
  const image = await processImage(uploads.pathFor(id));
  const [full, thumbnail] = await Promise.all([
    app.storage.save(Readable.from([image.full])),
    app.storage.save(Readable.from([image.thumbnail])),
  ]);
  return {
    storageKey: full.key,
    thumbnailKey: thumbnail.key,
    placeholder: image.placeholder,
    width: image.width,
    height: image.height,
    mime: 'image/webp',
    size: image.full.length,
  };
}

/** Removes an upload and everything stored for it. Attached media belongs to its message. */
async function destroy(app: FastifyInstance, doc: MediaDoc) {
  await area(app).remove(doc._id.toString());
  await Promise.all(
    [doc.storageKey, doc.thumbnailKey].flatMap((key) => (key ? [app.storage.delete(key)] : [])),
  );
  await chatModels(app).Media.deleteOne({ _id: doc._id });
}

export async function cancelUpload(app: FastifyInstance, userId: string, id: string) {
  const doc = await ownUpload(app, userId, id);
  if (doc.messageId) throw new AppError('CONFLICT', 'This file has already been sent.');
  await destroy(app, doc);
}

/** Inside the send transaction. Only the uploader, only finished files, and only once. */
export async function attachMedia(
  app: FastifyInstance,
  session: ClientSession,
  input: { mediaId: string; userId: string; chatId: string; messageId: MediaDoc['messageId'] },
): Promise<MediaDoc> {
  const attached = await chatModels(app)
    .Media.findOneAndUpdate(
      {
        _id: oid(input.mediaId),
        ownerId: oid(input.userId),
        status: 'ready',
        messageId: null,
      },
      { $set: { messageId: input.messageId, chatId: oid(input.chatId) } },
      { returnDocument: 'after', session },
    )
    .lean();
  if (!attached) {
    throw new AppError('MEDIA_NOT_ATTACHABLE', 'This file cannot be attached to a message.');
  }
  return attached;
}

/** The uploader, or a member of the chat holding the message. Others cannot tell it exists. */
export async function requireReadable(
  app: FastifyInstance,
  id: string,
  userId: string,
): Promise<MediaDoc> {
  const doc = await chatModels(app).Media.findById(id).lean();
  if (!doc) throw new AppError('NOT_FOUND', 'Media not found.');
  if (doc.ownerId.toString() === userId) return doc;
  if (!doc.chatId) throw new AppError('NOT_FOUND', 'Media not found.');
  // In a group, only what was sent while this person was there.
  const member = await requireParticipant(app, doc.chatId.toString(), userId).catch(() => {
    throw new AppError('NOT_FOUND', 'Media not found.');
  });
  const message = await chatModels(app).Message.findById(doc.messageId).select({ seq: 1 }).lean();
  if (!message || !canSeeSeq(member, message.seq)) {
    throw new AppError('NOT_FOUND', 'Media not found.');
  }
  return doc;
}

/** Uploads never attached to a message within a day: their files and their records go. */
export async function cleanupOrphans(
  app: FastifyInstance,
  now: Date = new Date(),
  batch = 200,
): Promise<number> {
  const orphans = await chatModels(app)
    .Media.find({ messageId: null, createdAt: { $lt: new Date(now.getTime() - ORPHAN_AGE_MS) } })
    .limit(batch)
    .lean();
  let removed = 0;
  for (const doc of orphans) {
    const lastWrite =
      doc.status === 'pending' ? await area(app).lastWrite(doc._id.toString()) : null;
    if (lastWrite && now.getTime() - lastWrite.getTime() < ACTIVE_UPLOAD_MS) continue;
    await destroy(app, doc);
    removed += 1;
  }
  return removed;
}
