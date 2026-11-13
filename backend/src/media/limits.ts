import {
  type CreateUploadBody,
  IMAGE_MAX_BYTES,
  type MediaKind,
  VOICE_DURATION_MARGIN_SECONDS,
  VOICE_MAX_BYTES,
} from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import type { Env } from '../config/env.ts';
import { AppError } from '../lib/errors.ts';
import type { StorageSpace } from '../storage/driver.ts';

/** Above this the disk is too full to accept more files. */
export const DISK_MAX_USED_RATIO = 0.9;

export const mediaMaxBytes = (env: Pick<Env, 'MEDIA_MAX_FILE_MB'>) =>
  env.MEDIA_MAX_FILE_MB * 1024 * 1024;

const KIND_MAX_BYTES: Partial<Record<MediaKind, number>> = {
  image: IMAGE_MAX_BYTES,
  voice: VOICE_MAX_BYTES,
};

export function uploadLimit(env: Pick<Env, 'MEDIA_MAX_FILE_MB'>, kind: MediaKind): number {
  return Math.min(mediaMaxBytes(env), KIND_MAX_BYTES[kind] ?? Number.POSITIVE_INFINITY);
}

/** What the configuration says about a file, before any bytes move. */
export function assertWithinLimits(
  env: Pick<Env, 'MEDIA_MAX_FILE_MB' | 'VOICE_MAX_SECONDS'>,
  body: CreateUploadBody,
): void {
  const limit = uploadLimit(env, body.kind);
  if (body.size > limit) {
    throw new AppError('PAYLOAD_TOO_LARGE', 'This file is over the size limit.', {
      maxBytes: limit,
    });
  }
  const longest = env.VOICE_MAX_SECONDS + VOICE_DURATION_MARGIN_SECONDS;
  if (body.kind === 'voice' && (body.duration ?? 0) > longest) {
    throw new AppError('BAD_REQUEST', 'This voice note is too long.', {
      maxSeconds: env.VOICE_MAX_SECONDS,
    });
  }
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
