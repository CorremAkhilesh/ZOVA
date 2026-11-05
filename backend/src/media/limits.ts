import { IMAGE_MAX_BYTES, type MediaKind } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import type { Env } from '../config/env.ts';
import { AppError } from '../lib/errors.ts';
import type { StorageSpace } from '../storage/driver.ts';

/** Above this the disk is too full to accept more files. */
export const DISK_MAX_USED_RATIO = 0.9;

export const mediaMaxBytes = (env: Pick<Env, 'MEDIA_MAX_FILE_MB'>) =>
  env.MEDIA_MAX_FILE_MB * 1024 * 1024;

export function uploadLimit(env: Pick<Env, 'MEDIA_MAX_FILE_MB'>, kind: MediaKind): number {
  const limit = mediaMaxBytes(env);
  return kind === 'image' ? Math.min(limit, IMAGE_MAX_BYTES) : limit;
}

export const wouldOverfill = ({ total, free }: StorageSpace, incoming: number) =>
  total - free + incoming > total * DISK_MAX_USED_RATIO;

/**
 * Refuses bytes the disk has no room for. Checked per chunk as well as at the start, because uploads
 * running side by side can each pass at the start. If the disk cannot be asked, the upload goes on:
 * this protects the disk, and a failed question does not mean it is full.
 */
export async function assertRoomFor(app: FastifyInstance, incoming: number): Promise<void> {
  let space: StorageSpace | null;
  try {
    space = await app.storage.space();
  } catch (error) {
    app.log.warn({ err: error }, 'could not read free disk space');
    return;
  }
  if (space && wouldOverfill(space, incoming)) {
    app.log.warn({ total: space.total, free: space.free, incoming }, 'upload refused: disk full');
    throw new AppError(
      'STORAGE_FULL',
      'The server is low on storage, so this file cannot be uploaded right now.',
    );
  }
}
