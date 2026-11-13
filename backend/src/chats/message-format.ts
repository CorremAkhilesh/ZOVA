import {
  formatDuration,
  type LastMessage,
  MESSAGE_PREVIEW_MAX,
  type MediaInfo,
  type Message,
} from '@zuvo/protocol';
import type {
  ChatDoc,
  ChatMemberDoc,
  LastMessageSnapshot,
  MessageDoc,
  StoredPoll,
} from '../db/chat-models.ts';

/** Whether this person may know a voice note was played. See `played` in the protocol. */
function playedFor(doc: MessageDoc, viewerId: string): boolean {
  const plays = doc.plays ?? [];
  if (doc.senderId?.toString() === viewerId) return plays.some((play) => play.shared);
  return plays.some((play) => play.userId.toString() === viewerId);
}

function toPoll(poll: StoredPoll): NonNullable<Message['poll']> {
  return {
    question: poll.question,
    options: poll.options.map((option) => ({
      id: option.id,
      text: option.text,
      voterIds: option.voterIds.map((id) => id.toString()),
    })),
    multiple: poll.multiple,
    closedAt: poll.closedAt ? new Date(poll.closedAt).toISOString() : null,
  };
}

/** View once never sends a thumbnail or a blurred placeholder: there is nothing to see before opening. */
function mediaFor(doc: MessageDoc): MediaInfo | null {
  const media = doc.media ?? null;
  return media && doc.viewOnce ? { ...media, placeholder: null, hasThumbnail: false } : media;
}

/** Disappearing and view-once fields; absent on ordinary messages. */
function timedFields(doc: MessageDoc, viewerId: string, deleted: boolean): Partial<Message> {
  const opened =
    doc.senderId?.toString() === viewerId
      ? Boolean(doc.viewOnceDoneAt)
      : (doc.viewOnceOpenedBy ?? []).some((id) => id.toString() === viewerId) ||
        Boolean(doc.viewOnceDoneAt);
  return {
    ...(doc.expiresAt ? { expiresAt: new Date(doc.expiresAt).toISOString() } : {}),
    ...(doc.viewOnce && !deleted ? { viewOnce: true, viewOnceOpened: opened } : {}),
    ...(doc.poll && !deleted ? { poll: toPoll(doc.poll) } : {}),
  };
}

/** A message as this person sees it. */
export function toMessage(doc: MessageDoc, viewerId: string): Message {
  const deleted = doc.deletedForEveryoneAt !== null;
  return {
    id: doc._id.toString(),
    chatId: doc.chatId.toString(),
    seq: doc.seq,
    clientMsgId: doc.clientMsgId,
    senderId: doc.senderId?.toString() ?? null,
    type: doc.type,
    text: deleted ? null : doc.text,
    media: deleted ? null : mediaFor(doc),
    albumId: doc.albumId ?? null,
    played: playedFor(doc, viewerId),
    system: doc.system ?? null,
    replyTo: deleted ? null : (doc.replyTo ?? null),
    forwarded: doc.forwarded === true,
    forwardCount: doc.forwardCount ?? 0,
    reactions: deleted
      ? []
      : (doc.reactions ?? []).map((reaction) => ({
          userId: reaction.userId.toString(),
          emoji: reaction.emoji,
          at: reaction.at.toISOString(),
        })),
    deletedByAdmin: doc.deletedByAdmin === true,
    linkPreview: deleted ? null : (doc.linkPreview ?? null),
    ...(doc.mentions?.length && !deleted
      ? {
          mentions: doc.mentions.map((mention) => ({
            userId: mention.userId.toString(),
            offset: mention.offset,
            length: mention.length,
          })),
        }
      : {}),
    ...(doc.mentionsEveryone && !deleted ? { mentionsEveryone: true } : {}),
    ...timedFields(doc, viewerId, deleted),
    replyToId: doc.replyToId?.toString() ?? null,
    editedAt: doc.editedAt?.toISOString() ?? null,
    deletedForEveryoneAt: doc.deletedForEveryoneAt?.toISOString() ?? null,
    createdAt: doc.createdAt.toISOString(),
  };
}

/** Which message the chat list shows this person. */
export function shownLast(
  chat: Pick<ChatDoc, 'lastMessage'>,
  member: Pick<
    ChatMemberDoc,
    'leftAt' | 'leftView' | 'previewFloor' | 'previewLast' | 'clearedSeq'
  >,
): LastMessageSnapshot | null {
  // Someone who left sees the chat as it was then, however it has moved on since.
  const latest = (member.leftAt ? member.leftView?.lastMessage : chat.lastMessage) ?? null;
  const shown =
    latest && latest.seq <= (member.previewFloor ?? 0) ? (member.previewLast ?? null) : latest;
  return shown && shown.seq > (member.clearedSeq ?? 0) ? shown : null;
}

/** A reply to something from before this person could see: they learn only that it was a reply. */
export function hideQuote(
  message: Message,
  member: { joinSeq?: number | undefined; clearedSeq?: number | undefined },
): Message {
  const { replyTo } = message;
  if (!replyTo || replyTo.chatId !== message.chatId) return message;
  if (replyTo.seq > Math.max(member.joinSeq ?? 0, member.clearedSeq ?? 0)) return message;
  return {
    ...message,
    replyTo: {
      ...replyTo,
      text: '',
      senderId: null,
      senderName: '',
      mediaId: null,
      hasThumbnail: false,
      unavailable: true,
    },
  };
}

export function toLastMessage(snapshot: LastMessageSnapshot): LastMessage {
  return {
    id: snapshot.id.toString(),
    seq: snapshot.seq,
    senderId: snapshot.senderId?.toString() ?? null,
    type: snapshot.type,
    preview: snapshot.preview,
    system: snapshot.system ?? null,
    deleted: snapshot.deleted === true,
    createdAt: snapshot.createdAt.toISOString(),
  };
}

/** One line for the chat list: whitespace collapsed, cut at a whole character. */
export function toPreview(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  const characters = Array.from(line);
  return characters.length > MESSAGE_PREVIEW_MAX
    ? `${characters.slice(0, MESSAGE_PREVIEW_MAX).join('')}…`
    : line;
}

/** For the chat list. Clients add the icon and the words "Photo" or "Video", in their language. */
export function toMediaPreview(media: MediaInfo, caption: string | undefined): string {
  if (media.kind === 'voice') return formatDuration(media.duration ?? 0);
  if (media.kind === 'document' || media.kind === 'audio')
    return toPreview(caption ? `${media.name} · ${caption}` : media.name);
  return toPreview(caption ?? '');
}

/** Polls show their question; clients add "📊 Poll:" in their language. */
export const previewOf = (
  media: MediaInfo | null | undefined,
  text: string | null | undefined,
  poll?: Pick<StoredPoll, 'question'> | null,
) =>
  poll
    ? toPreview(poll.question)
    : media
      ? toMediaPreview(media, text ?? undefined)
      : toPreview(text ?? '');
