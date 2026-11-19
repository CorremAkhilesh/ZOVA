import type { Draft } from '@zuvo/protocol';
import { pushDraft } from '@/features/drafts/draft-sync';
import { prepareFile } from '@/features/media/process';
import { toUploadInfo } from '@/features/media/use-send-media';
import type { SyncClient } from '@/features/sync/client';
import type { LocalDb } from '@/features/sync/local-db';
import { uuidv7 } from '@/lib/uuid';
import type { SharedFile } from '@/sw/share/store';

/** At most this many chats at once, like other messengers. */
export const SHARE_CHATS_MAX = 5;

/** Files over the server's limit (bytes), which cannot be sent. */
export const tooLarge = (files: SharedFile[], maxBytes: number | null) =>
  maxBytes === null ? [] : files.filter((file) => file.size > maxBytes);

const asFile = (shared: SharedFile) =>
  shared.blob instanceof File && shared.blob.name === shared.name
    ? shared.blob
    : new File([shared.blob], shared.name, { type: shared.type });

/**
 * Sends the shared files to each chat through the outbox (resumable uploads, progress in the chat):
 * pictures and videos together as an album, the caption on the first file.
 */
export async function sendSharedFiles(input: {
  client: Pick<SyncClient, 'sendMedia'>;
  chatIds: string[];
  files: SharedFile[];
  caption: string;
}): Promise<void> {
  const prepared = await Promise.all(input.files.map((file) => prepareFile(asFile(file), false)));
  const visual = prepared.filter((file) => file.kind === 'image' || file.kind === 'video');
  for (const chatId of input.chatIds) {
    const albumId = visual.length > 1 ? uuidv7() : undefined;
    for (const [index, file] of prepared.entries()) {
      const isVisual = file.kind === 'image' || file.kind === 'video';
      await input.client.sendMedia({
        chatId,
        caption: index === 0 ? input.caption.trim() : '',
        file: file.file,
        poster: file.poster,
        albumId: isVisual ? albumId : undefined,
        info: toUploadInfo(file),
      });
    }
  }
}

/** Only text or a link was shared: it waits in the chat's message box, ready to edit and send. */
export async function prefillDraft(db: LocalDb, chatId: string, text: string): Promise<void> {
  const draft: Draft = { text, replyTo: null, updatedAt: new Date().toISOString() };
  await db.chats.update(chatId, { draft });
  pushDraft(db, chatId);
}
