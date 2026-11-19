import { type CreateUploadBody, MESSAGE_PREVIEW_MAX } from '@zuvo/protocol';
import { uuidv7 } from '@/lib/uuid';
import { type LocalDb, PENDING_ORDER_BASE } from './local-db';

type Preview = (
  chatId: string,
  key: string,
  last: { type: CreateUploadBody['kind']; preview: string; createdAt: string },
) => Promise<void>;

/**
 * One file to several chats ("Share to Zuvo"): the file uploads once, on the first chat's row; each
 * other chat gets a row of its own that waits for that upload (`shareOf`) and then sends the same
 * file by reference (`sharedMediaId`), so a 1 GB video to five chats goes up once. Each row sends,
 * fails and retries on its own. Call inside the transaction that wrote the source row.
 */
export async function writeShareRows(
  db: LocalDb,
  me: string,
  input: {
    sourceClientMsgId: string;
    chatIds: string[];
    caption: string;
    info: CreateUploadBody;
    albumId: string | undefined;
    preview: Preview;
    previewText: string;
  },
): Promise<void> {
  const createdAt = new Date().toISOString();
  for (const chatId of input.chatIds) {
    const clientMsgId = uuidv7();
    const key = `${me}:${clientMsgId}`;
    const n = await db.outbox.add({
      clientMsgId,
      chatId,
      text: input.caption,
      attempts: 0,
      state: 'pending',
      queuedAt: Date.now(),
      media: input.info,
      albumId: input.albumId,
      shareOf: input.sourceClientMsgId,
    });
    const { info } = input;
    await db.messages.add({
      key,
      id: null,
      seq: null,
      order: PENDING_ORDER_BASE + n,
      chatId,
      clientMsgId,
      senderId: me,
      type: info.kind,
      text: input.caption || null,
      media: {
        id: '',
        kind: info.kind,
        mime: info.mime,
        size: info.size,
        name: info.name,
        width: info.width ?? null,
        height: info.height ?? null,
        duration: info.duration ?? null,
        waveform: info.waveform ?? null,
        placeholder: null,
        hasThumbnail: false,
      },
      albumId: input.albumId ?? null,
      played: false,
      replyTo: null,
      replyToId: null,
      editedAt: null,
      deletedForEveryoneAt: null,
      createdAt,
      status: 'pending',
      uploadedBytes: 0,
    });
    await input.preview(chatId, key, {
      type: info.kind,
      preview: input.previewText.slice(0, MESSAGE_PREVIEW_MAX),
      createdAt,
    });
  }
}

/** The rows sharing a file with `sourceClientMsgId` (they follow its upload). */
export const sharesOf = (db: LocalDb, sourceClientMsgId: string) =>
  db.outbox.filter((row) => row.shareOf === sourceClientMsgId).toArray();
