import {
  type CreateUploadBody,
  formatDuration,
  type LastMessage,
  type LinkPreview,
  MESSAGE_PREVIEW_MAX,
  type Mention,
  type ReplyQuote,
  type SendMessagePayload,
  type StatusReply,
} from '@zuvo/protocol';
import { soundForSent } from '@/features/notifications/app-sounds';
import { uuidv7 } from '@/lib/uuid';
import { holdFile, releaseFile } from './held-files';
import {
  type FileRow,
  type LocalDb,
  type MessageRow,
  type OutboxRow,
  PENDING_ORDER_BASE,
} from './local-db';
import { writeShareRows } from './outbox-share';
import { isQuotaError, mustHold, toStorable } from './stored-bytes';

/** The same line the server will write for the chat list. */
function previewOf(info: CreateUploadBody, caption: string): string {
  if (info.kind === 'voice') return formatDuration(info.duration ?? 0);
  if (info.kind === 'document' || info.kind === 'audio') {
    return [info.name, caption].filter(Boolean).join(' · ');
  }
  return caption;
}

export const toPayload = (row: OutboxRow): SendMessagePayload =>
  row.shareOf
    ? {
        chatId: row.chatId,
        clientMsgId: row.clientMsgId,
        sharedMediaId: row.mediaId ?? '',
        ...(row.text ? { caption: row.text } : {}),
        ...(row.albumId ? { albumId: row.albumId } : {}),
      }
    : row.media
      ? {
          chatId: row.chatId,
          clientMsgId: row.clientMsgId,
          mediaIds: [row.mediaId ?? ''],
          ...(row.replyTo ? { replyTo: row.replyTo } : {}),
          ...(row.text ? { caption: row.text } : {}),
          ...(row.albumId ? { albumId: row.albumId } : {}),
          ...(row.viewOnce ? { viewOnce: true } : {}),
        }
      : row.poll
        ? { chatId: row.chatId, clientMsgId: row.clientMsgId, poll: row.poll }
        : {
            chatId: row.chatId,
            clientMsgId: row.clientMsgId,
            text: row.text,
            ...(row.replyTo ? { replyTo: row.replyTo } : {}),
            ...(row.linkPreviewId ? { linkPreviewId: row.linkPreviewId } : {}),
            ...(row.mentions?.length ? { mentions: row.mentions } : {}),
            ...(row.mentionsEveryone ? { mentionsEveryone: true } : {}),
            ...(row.statusId ? { statusId: row.statusId } : {}),
          };

/** A preview the sender looked up for a link in the text, sent along with it. */
export interface AttachedPreview {
  id: string;
  preview: LinkPreview;
}

/** What else goes with a text message: a link preview, and in groups who it mentions. */
export interface SendExtras {
  link?: AttachedPreview | null | undefined;
  mentions?: Mention[] | undefined;
  mentionsEveryone?: boolean | undefined;
  /** A reply to someone's status (in our 1:1 chat): the copy shown above it. */
  statusReply?: StatusReply | undefined;
}

const refOf = (quote: ReplyQuote | null | undefined) =>
  quote ? { replyTo: { chatId: quote.chatId, messageId: quote.id } } : {};

/** A text message as it shows until the server has it. */
export const pendingTextRow = (
  input: { key: string; n: number; chatId: string; clientMsgId: string; me: string; text: string },
  createdAt: string,
  quote: ReplyQuote | null | undefined,
): MessageRow => ({
  key: input.key,
  id: null,
  seq: null,
  order: PENDING_ORDER_BASE + input.n,
  chatId: input.chatId,
  clientMsgId: input.clientMsgId,
  senderId: input.me,
  type: 'text',
  text: input.text,
  media: null,
  albumId: null,
  played: false,
  replyTo: quote ?? null,
  replyToId: null,
  editedAt: null,
  deletedForEveryoneAt: null,
  createdAt,
  status: 'pending',
});

export const outboxReply = refOf;

export interface EnqueueMedia {
  chatId: string;
  caption: string;
  info: CreateUploadBody;
  file: Blob;
  poster?: Blob | undefined;
  albumId?: string | undefined;
  replyTo?: ReplyQuote | null | undefined;
  /** A photo or video the others can open once. */
  viewOnce?: boolean | undefined;
  /** Other chats that get the same file, uploaded only once (see outbox-share.ts). */
  alsoTo?: string[] | undefined;
}

type Preview = (
  chatId: string,
  key: string,
  last: { type: LastMessage['type']; preview: string; createdAt: string },
) => Promise<void>;

/**
 * Keeps the file for a resumable upload where the browser has room. Where it has none, the upload
 * still goes ahead from this tab, and the message says to keep the tab open.
 */
export async function storeMedia(
  db: LocalDb,
  me: string,
  input: EnqueueMedia,
  preview: Preview,
): Promise<string> {
  const { file, poster } = input;
  const clientMsgId = uuidv7();
  soundForSent();
  if (!(await mustHold(db, file.size))) {
    try {
      const keep: FileRow = { clientMsgId, file: await toStorable(db, file) };
      if (poster) keep.poster = await toStorable(db, poster);
      await writeRows(db, me, clientMsgId, input, preview, keep);
      return clientMsgId;
    } catch (error) {
      if (!isQuotaError(error)) throw error;
    }
  }
  holdFile(clientMsgId, file, poster);
  try {
    await writeRows(db, me, clientMsgId, input, preview, null);
  } catch (error) {
    releaseFile(clientMsgId);
    throw error;
  }
  return clientMsgId;
}

/** The file, its outbox row and its message all together, so a reload can never split them. */
async function writeRows(
  db: LocalDb,
  me: string,
  clientMsgId: string,
  input: EnqueueMedia,
  preview: Preview,
  keep: FileRow | null,
) {
  const { chatId, caption, info, albumId, replyTo } = input;
  const once = input.viewOnce ? { viewOnce: true } : {};
  const key = `${me}:${clientMsgId}`;
  const createdAt = new Date().toISOString();
  const held = keep ? {} : { heldInTab: true };
  await db.transaction('rw', [db.outbox, db.messages, db.chats, db.files], async () => {
    if (keep) await db.files.add(keep);
    const n = await db.outbox.add({
      ...held,
      clientMsgId,
      chatId,
      text: caption,
      attempts: 0,
      state: 'pending',
      queuedAt: Date.now(),
      media: info,
      albumId,
      ...refOf(replyTo),
      ...once,
    });
    await db.messages.add({
      ...held,
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
        waveform: info.waveform ?? null,
        placeholder: null,
        hasThumbnail: false,
      },
      albumId: albumId ?? null,
      played: false,
      replyTo: replyTo ?? null,
      replyToId: null,
      editedAt: null,
      deletedForEveryoneAt: null,
      createdAt,
      status: 'pending',
      uploadedBytes: 0,
      ...once,
    });
    const text = previewOf(info, caption);
    await preview(chatId, key, {
      type: info.kind,
      preview: text.slice(0, MESSAGE_PREVIEW_MAX),
      createdAt,
    });
    if (input.alsoTo?.length) {
      await writeShareRows(db, me, {
        sourceClientMsgId: clientMsgId,
        chatIds: input.alsoTo,
        caption,
        info,
        albumId,
        preview,
        previewText: text,
      });
    }
  });
}

export async function removeQueued(
  db: LocalDb,
  me: string,
  clientMsgId: string,
): Promise<string | undefined> {
  let uploadId: string | undefined;
  releaseFile(clientMsgId);
  await db.transaction('rw', db.outbox, db.messages, db.files, async () => {
    const row = await db.outbox.where('clientMsgId').equals(clientMsgId).first();
    uploadId = row?.uploadId;
    if (row?.n !== undefined) await db.outbox.delete(row.n);
    await db.messages.delete(`${me}:${clientMsgId}`);
    await db.files.delete(clientMsgId);
  });
  return uploadId;
}

/**
 * "Tap to retry": queued again from the start. A file message with nothing left to send it from
 * says so instead (remove it, or choose the file again), so it can never stay "Not sent" for good.
 */
export async function requeue(db: LocalDb, me: string, clientMsgId: string): Promise<void> {
  await db.transaction('rw', db.outbox, db.messages, async () => {
    const key = `${me}:${clientMsgId}`;
    const queued = await db.outbox
      .where('clientMsgId')
      .equals(clientMsgId)
      .modify({ state: 'pending', attempts: 0, queuedAt: Date.now() });
    const message = await db.messages.get(key);
    if (queued === 0 && message?.media) {
      await db.messages.update(key, { status: 'failed', failReason: 'fileLost' });
      return;
    }
    await db.messages.update(key, { status: 'pending', failReason: undefined });
  });
}
