import { Readable } from 'node:stream';
import { WALLPAPER_IMAGES_MAX } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import sharp from 'sharp';
import type { WallpaperImageDoc } from '../db/appearance-models.ts';
import { AppError } from '../lib/errors.ts';
import { assertRoomFor } from '../media/limits.ts';
import { detectImageType } from '../users/avatar.ts';
import { appearanceModels, forgetWallpaperImage, oidOf } from './appearance.service.ts';

/** The long side of a stored wallpaper, in pixels. */
export const WALLPAPER_MAX_SIDE = 2560;

/**
 * Checked by its first bytes (JPEG, PNG, WebP, HEIC), turned upright, stripped of metadata and
 * re-encoded as WebP of at most 2560 px on the long side.
 */
export async function processWallpaper(input: Uint8Array): Promise<Buffer> {
  const type = detectImageType(input);
  if (!type) throw new AppError('UNSUPPORTED_MEDIA_TYPE', 'Use a JPEG, PNG, WebP or HEIC picture.');
  try {
    return await sharp(input, { failOn: 'error', limitInputPixels: 50_000_000 })
      .rotate()
      .resize(WALLPAPER_MAX_SIDE, WALLPAPER_MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw new AppError(
      'UNSUPPORTED_MEDIA_TYPE',
      type === 'heic'
        ? 'This HEIC picture could not be read. Choose it again from the app, or use JPEG.'
        : 'This picture could not be read. Try another one.',
    );
  }
}

export interface WallpaperImage {
  id: string;
  url: string;
}

export const toWallpaperImage = (doc: Pick<WallpaperImageDoc, '_id'>): WallpaperImage => ({
  id: doc._id.toString(),
  url: `/v1/me/wallpapers/${doc._id.toString()}`,
});

export async function listWallpapers(app: FastifyInstance, userId: string) {
  const docs = await appearanceModels(app)
    .WallpaperImage.find({ userId: oidOf(userId) })
    .sort({ createdAt: 1 })
    .select({ _id: 1 })
    .lean();
  return docs.map(toWallpaperImage);
}

const countMine = (app: FastifyInstance, userId: string) =>
  appearanceModels(app).WallpaperImage.countDocuments({ userId: oidOf(userId) });

function assertRoomForMore(count: number) {
  if (count >= WALLPAPER_IMAGES_MAX) {
    throw new AppError(
      'CONFLICT',
      `You can keep up to ${WALLPAPER_IMAGES_MAX} pictures. Delete one first.`,
    );
  }
}

/** Saves a new picture of mine under a random key (never the uploaded name). */
export async function addWallpaper(app: FastifyInstance, userId: string, bytes: Buffer) {
  assertRoomForMore(await countMine(app, userId));
  const webp = await processWallpaper(bytes);
  await assertRoomFor(app, webp.length);
  const { WallpaperImage } = appearanceModels(app);
  const stored = await app.storage.save(Readable.from([webp]));
  const doc = await WallpaperImage.create({
    userId: oidOf(userId),
    key: stored.key,
    size: stored.size,
  });
  // Uploads side by side can each pass the first check: the one over the limit is undone.
  if ((await countMine(app, userId)) > WALLPAPER_IMAGES_MAX) {
    await WallpaperImage.deleteOne({ _id: doc._id });
    await app.storage.delete(stored.key);
    assertRoomForMore(WALLPAPER_IMAGES_MAX);
  }
  return toWallpaperImage(doc);
}

/** One of my pictures. Someone else's id is answered exactly like a missing one. */
export async function requireMyWallpaper(app: FastifyInstance, userId: string, id: string) {
  const doc = Types.ObjectId.isValid(id)
    ? ((await appearanceModels(app)
        .WallpaperImage.findOne({ _id: oidOf(id), userId: oidOf(userId) })
        .lean()) as WallpaperImageDoc | null)
    : null;
  if (!doc) throw new AppError('NOT_FOUND', 'Wallpaper not found.');
  return doc;
}

export async function deleteWallpaper(app: FastifyInstance, userId: string, id: string) {
  const doc = await requireMyWallpaper(app, userId, id);
  await appearanceModels(app).WallpaperImage.deleteOne({ _id: doc._id });
  await forgetWallpaperImage(app, userId, id);
  await app.storage
    .delete(doc.key)
    .catch((error: unknown) => app.log.warn({ err: error }, 'could not delete a wallpaper file'));
}
