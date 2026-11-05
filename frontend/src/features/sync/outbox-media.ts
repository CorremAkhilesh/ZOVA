import { type CreateUploadBody, type LastMessage, MESSAGE_PREVIEW_MAX } from '@zuvo/protocol';
import { uuidv7 } from '@/lib/uuid';
import { type LocalDb, PENDING_ORDER_BASE } from './local-db';

export interface EnqueueMedia {
  chatId: string;
  caption: string;
  info: CreateUploadBody;
  file: Blob;
  poster?: Blob | undefined;
  albumId?: string | undefined;
}

type Preview = (
  chatId: string,
  key: string,
  last: { type: LastMessage['type']; preview: string; createdAt: string },
) => Promise<void>;

/** The file, its outbox row and its message all together, so a reload can never split them. */
export async function storeMedia(
  db: LocalDb,
  me: string,
  input: EnqueueMedia,
  preview: Preview,
): Promise<string> {
  const { chatId, caption, info, file, poster, albumId } = input;
  const clientMsgId = uuidv7();
  const key = `${me}:${clientMsgId}`;
  const createdAt = new Date().toISOString();
  await db.transaction('rw', [db.outbox, db.messages, db.chats, db.files], async () => {
    await db.files.add({ clientMsgId, file, ...(poster ? { poster } : {}) });
    const n = await db.outbox.add({
      clientMsgId,
      chatId,
      text: caption,
      attempts: 0,
      state: 'pending',
      queuedAt: Date.now(),
      media: info,
      albumId,
    });
    await db.messages.add({
      key,
      id: null,
      seq: null,
      order: PENDING_ORDER_BASE + n,
      chatId,
      clientMsgId,
      senderId: me,
      type: info.kind,
      text: caption || null,
      media: {
        id: '',
        kind: info.kind,
        mime: info.mime,
        size: info.size,
        name: info.name,
        width: info.width ?? null,
        height: info.height ?? null,
        duration: info.duration ?? null,
        placeholder: null,
        hasThumbnail: false,
      },
      albumId: albumId ?? null,
      replyToId: null,
      editedAt: null,
      deletedForEveryoneAt: null,
      createdAt,
      status: 'pending',
      uploadedBytes: 0,
    });
    const text =
      info.kind === 'document' ? [info.name, caption].filter(Boolean).join(' · ') : caption;
    await preview(chatId, key, {
      type: info.kind,
      preview: text.slice(0, MESSAGE_PREVIEW_MAX),
      createdAt,
    });
  });
  return clientMsgId;
}

export async function removeQueued(
  db: LocalDb,
  me: string,
  clientMsgId: string,
): Promise<string | undefined> {
  let uploadId: string | undefined;
  await db.transaction('rw', db.outbox, db.messages, db.files, async () => {
    const row = await db.outbox.where('clientMsgId').equals(clientMsgId).first();
    uploadId = row?.uploadId;
    if (row?.n !== undefined) await db.outbox.delete(row.n);
    await db.messages.delete(`${me}:${clientMsgId}`);
    await db.files.delete(clientMsgId);
  });
  return uploadId;
}
