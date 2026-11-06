import { z } from 'zod';
import { isoDateTimeSchema, objectIdSchema } from '../common/id.ts';
import {
  chatTypeSchema,
  clientMsgIdSchema,
  lastMessageSchema,
  lastReactionSchema,
  markReadBodySchema,
  markReadResponseSchema,
  messageSchema,
  messageTextSchema,
  syncCursorSchema,
} from '../rest/chats.ts';
import { groupInfoSchema } from '../rest/groups.ts';
import { CAPTION_MAX } from '../rest/media.ts';

/** A caption on media, or a message's text. Must say something if present. */
const captionSchema = z.string().max(CAPTION_MAX);

/** message:send (client → server): either text, or one finished upload and maybe a caption. */
export const sendMessagePayloadSchema = z
  .object({
    chatId: objectIdSchema,
    clientMsgId: clientMsgIdSchema,
    text: messageTextSchema.optional(),
    /** The message this answers. Replying privately from a group names a different chat. */
    replyTo: z.object({ chatId: objectIdSchema, messageId: objectIdSchema }).optional(),
    mediaIds: z.array(objectIdSchema).length(1).optional(),
    caption: captionSchema.optional(),
    /** Client-made, the same on every item of an album. */
    albumId: z.uuid().optional(),
  })
  .refine((message) => (message.text === undefined) !== (message.mediaIds === undefined), {
    message: 'Send either text or media',
  })
  .refine((message) => message.mediaIds !== undefined || message.caption === undefined, {
    message: 'A caption needs media',
  });
export const sendMessageAckSchema = z.object({
  messageId: z.string(),
  seq: z.number().int().positive(),
  createdAt: isoDateTimeSchema,
  /** True when this clientMsgId had already been sent: the original message is returned. */
  duplicate: z.boolean(),
});

/** read:update (client → server) */
export const readUpdatePayloadSchema = markReadBodySchema.extend({ chatId: objectIdSchema });
export const readUpdateAckSchema = markReadResponseSchema;

/** message:new (server → client): to every member's devices, including the sender's others. */
export const messageNewEventSchema = z.object({
  message: messageSchema,
  /** This user's sync position after this change. */
  cursor: syncCursorSchema,
});

/** chat:updated (server → client): what changed in a chat, as this user sees it. */
export const chatUpdatedEventSchema = z.object({
  chatId: z.string(),
  type: chatTypeSchema,
  seq: z.number().int().nonnegative(),
  lastMessage: lastMessageSchema.nullable(),
  lastReadSeq: z.number().int().nonnegative(),
  unreadCount: z.number().int().nonnegative(),
  lastActivityAt: isoDateTimeSchema.nullable(),
  /** A group as this user now sees it, when a system message changed it. */
  group: groupInfoSchema.optional(),
  pinned: z.boolean().optional(),
  mutedUntil: isoDateTimeSchema.nullable().optional(),
  archived: z.boolean().optional(),
  markedUnread: z.boolean().optional(),
  /** Sent with new messages in direct chats: replying also means having received and read. */
  peerDeliveredSeq: z.number().int().nonnegative().optional(),
  peerReadSeq: z.number().int().nonnegative().optional(),
  cursor: syncCursorSchema,
});

/** read:update (server → client): this user read further, on this or another device. */
export const readUpdateEventSchema = z.object({
  chatId: z.string(),
  lastReadSeq: z.number().int().nonnegative(),
  unreadCount: z.number().int().nonnegative(),
  cursor: syncCursorSchema,
});

/** session:revoked (server → client): sent just before the server closes the socket. */
export const sessionRevokedEventSchema = z.object({
  reason: z.enum(['revoked', 'deactivated', 'expired']),
});

/** delivered:update (client → server): this device has stored everything up to `seq`. */
export const deliveredUpdatePayloadSchema = markReadBodySchema.extend({ chatId: objectIdSchema });
export const deliveredUpdateAckSchema = z.object({
  chatId: z.string(),
  lastDeliveredSeq: z.number().int().nonnegative(),
});

/** typing:start / typing:stop (client → server). */
export const typingPayloadSchema = z.object({ chatId: objectIdSchema });
/** typing:update (server → client): to the other members' sockets only. Never stored. */
export const typingEventSchema = z.object({
  chatId: z.string(),
  userId: z.string(),
  typing: z.boolean(),
});

/** How many people a socket may watch at once. */
export const PRESENCE_WATCH_MAX = 100;

/** presence:subscribe (client → server): the full list to watch, replacing the previous one. */
export const presenceSubscribePayloadSchema = z.object({
  userIds: z.array(objectIdSchema).max(PRESENCE_WATCH_MAX),
});
/** presence:active (client → server): false once the tab has been hidden for a while. */
export const presenceActivePayloadSchema = z.object({ active: z.boolean() });

/** Offline with no time also means "hidden": privacy never says which. */
export const presenceEventSchema = z.object({
  userId: z.string(),
  online: z.boolean(),
  lastSeenAt: isoDateTimeSchema.nullable(),
});
export const presenceSubscribeAckSchema = z.object({ users: z.array(presenceEventSchema) });
/** presence:resubscribe (server → client): privacy changed, so ask again for what is visible. */
export const presenceResubscribeEventSchema = z.object({});

/** receipt:update (server → client): the other person received or read further. */
export const receiptEventSchema = z.object({
  chatId: z.string(),
  userId: z.string(),
  lastDeliveredSeq: z.number().int().nonnegative(),
  /** Stops moving while either person has read receipts off. */
  lastReadSeq: z.number().int().nonnegative(),
  cursor: syncCursorSchema,
});

/** voice:played (client → server): I played this voice note to the end, or past half way. */
export const voicePlayedPayloadSchema = z.object({
  chatId: objectIdSchema,
  messageId: objectIdSchema,
});
export const voicePlayedAckSchema = z.object({ messageId: z.string(), played: z.boolean() });

/**
 * message:played (server → client): a voice note's `played` changed, as this user sees it. To my own
 * devices always; to the sender only while both people have read receipts on.
 */
export const messagePlayedEventSchema = z.object({
  message: messageSchema,
  cursor: syncCursorSchema,
});

/** message:updated (server → client): edited, deleted for everyone, reacted to or starred. */
export const messageUpdatedEventSchema = z.object({
  message: messageSchema,
  cursor: syncCursorSchema,
});

/** message:removed (server → client): I deleted this for me on one of my devices. */
export const messageRemovedEventSchema = z.object({
  chatId: z.string(),
  seq: z.number().int(),
  cursor: syncCursorSchema,
});

/** chat:cleared (server → client): I cleared or deleted this chat on one of my devices. */
export const chatClearedEventSchema = z.object({
  chatId: z.string(),
  seq: z.number().int(),
  removeChat: z.boolean(),
  cursor: syncCursorSchema,
});

/** reaction:preview (server → client): to a message's author only. */
export const reactionPreviewEventSchema = z.object({
  chatId: z.string(),
  lastReaction: lastReactionSchema.nullable(),
});

export type SendMessagePayload = z.infer<typeof sendMessagePayloadSchema>;
export type SendMessageAck = z.infer<typeof sendMessageAckSchema>;
export type PresenceEvent = z.infer<typeof presenceEventSchema>;
export type SessionRevokedReason = z.infer<typeof sessionRevokedEventSchema>['reason'];
