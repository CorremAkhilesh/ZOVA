import type { CreateUploadBody, MediaInfo } from '@zuvo/protocol';
import { type MediaApi, mediaApi } from '@/features/media/api';
import { chunkSizeFor } from '@/features/media/uploader';
import { scheduledApi } from './api';

/** One file to schedule: what the upload says about it, and its caption. */
export interface MediaToSchedule {
  file: Blob;
  info: CreateUploadBody;
  poster?: Blob | undefined;
  caption: string;
}

/**
 * Uploads a file now, in the foreground, and returns it once the server has all of it. A scheduled
 * message needs a finished upload: unlike sending, nothing on this device is left to finish it.
 */
export async function uploadNow(
  item: Pick<MediaToSchedule, 'file' | 'info' | 'poster'>,
  onBytes: (sent: number) => void,
  api: MediaApi = mediaApi,
): Promise<MediaInfo> {
  const { uploadId } = await api.create(item.info);
  if (item.poster) await api.setPoster(uploadId, item.poster);
  const chunkBytes = chunkSizeFor(item.info.size);
  const signal = new AbortController().signal;
  let offset = 0;
  while (offset < item.info.size) {
    offset = await api.sendChunk(
      uploadId,
      offset,
      item.file.slice(offset, offset + chunkBytes),
      signal,
    );
    onBytes(offset);
  }
  return api.complete(uploadId);
}

/**
 * Uploads every file, then schedules one message per file at `at`, each with its own caption (a
 * voice note has none). `onProgress` gets the share of all bytes sent, from 0 to 1.
 */
export async function scheduleMedia(
  chatId: string,
  items: MediaToSchedule[],
  at: Date,
  onProgress: (fraction: number) => void = () => {},
  api: MediaApi = mediaApi,
): Promise<void> {
  const total = items.reduce((sum, item) => sum + item.info.size, 0) || 1;
  let done = 0;
  const uploaded: { media: MediaInfo; caption: string }[] = [];
  for (const item of items) {
    const media = await uploadNow(item, (sent) => onProgress((done + sent) / total), api);
    done += item.info.size;
    uploaded.push({ media, caption: item.caption.trim() });
  }
  for (const { media, caption } of uploaded) {
    await scheduledApi.create({
      chatId,
      mediaId: media.id,
      sendAt: at.toISOString(),
      ...(caption ? { text: caption } : {}),
    });
  }
}
