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

// Reserved for Step 10; the server answers the client events with BAD_REQUEST until then.
export const typingPayloadSchema = z.object({ chatId: objectIdSchema });
export const typingEventSchema = z.object({ chatId: z.string(), userId: z.string() });
export const presenceEventSchema = z.object({
  userId: z.string(),
  online: z.boolean(),
  lastSeenAt: isoDateTimeSchema.nullable(),
});
export const receiptEventSchema = z.object({
  chatId: z.string(),
  userId: z.string(),
  lastDeliveredSeq: z.number().int().nonnegative(),
  lastReadSeq: z.number().int().nonnegative(),
});

export type SendMessagePayload = z.infer<typeof sendMessagePayloadSchema>;
export type SendMessageAck = z.infer<typeof sendMessageAckSchema>;
export type SessionRevokedReason = z.infer<typeof sessionRevokedEventSchema>['reason'];
