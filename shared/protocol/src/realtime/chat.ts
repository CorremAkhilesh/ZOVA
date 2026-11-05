import { z } from 'zod';
import { isoDateTimeSchema, objectIdSchema } from '../common/id.ts';
import {
  chatTypeSchema,
  clientMsgIdSchema,
  lastMessageSchema,
  markReadBodySchema,
  markReadResponseSchema,
  messageSchema,
  messageTextSchema,
  syncCursorSchema,
} from '../rest/chats.ts';

/** message:send (client → server) */
export const sendMessagePayloadSchema = z.object({
  chatId: objectIdSchema,
  clientMsgId: clientMsgIdSchema,
  text: messageTextSchema,
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
  /** Sent with new messages in direct chats: replying also means having received and read. */
  peerDeliveredSeq: z.number().int().nonnegative().optional(),
  peerReadSeq: z.number().int().nonnegative().nullable().optional(),
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
  /** Null when either person has read receipts off: read information is never sent then. */
  lastReadSeq: z.number().int().nonnegative().nullable(),
  cursor: syncCursorSchema,
});

export type SendMessagePayload = z.infer<typeof sendMessagePayloadSchema>;
export type SendMessageAck = z.infer<typeof sendMessageAckSchema>;
export type PresenceEvent = z.infer<typeof presenceEventSchema>;
export type SessionRevokedReason = z.infer<typeof sessionRevokedEventSchema>['reason'];
