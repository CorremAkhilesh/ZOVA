import { z } from 'zod';
import type { AckResponse } from './ack.ts';
import {
  chatUpdatedEventSchema,
  deliveredUpdateAckSchema,
  deliveredUpdatePayloadSchema,
  messageNewEventSchema,
  messagePlayedEventSchema,
  presenceActivePayloadSchema,
  presenceEventSchema,
  presenceResubscribeEventSchema,
  presenceSubscribeAckSchema,
  presenceSubscribePayloadSchema,
  readUpdateAckSchema,
  readUpdateEventSchema,
  readUpdatePayloadSchema,
  receiptEventSchema,
  sendMessageAckSchema,
  sendMessagePayloadSchema,
  sessionRevokedEventSchema,
  typingEventSchema,
  typingPayloadSchema,
  voicePlayedAckSchema,
  voicePlayedPayloadSchema,
} from './chat.ts';

/** A client → server event: its payload schema and the schema of the ack data it returns. */
export interface ClientEventDefinition {
  payload: z.ZodType;
  ack: z.ZodType;
}

/** Events the client emits. */
export const clientToServerEvents = {
  'message:send': { payload: sendMessagePayloadSchema, ack: sendMessageAckSchema },
  'read:update': { payload: readUpdatePayloadSchema, ack: readUpdateAckSchema },
  'delivered:update': { payload: deliveredUpdatePayloadSchema, ack: deliveredUpdateAckSchema },
  'voice:played': { payload: voicePlayedPayloadSchema, ack: voicePlayedAckSchema },
  'typing:start': { payload: typingPayloadSchema, ack: z.object({}) },
  'typing:stop': { payload: typingPayloadSchema, ack: z.object({}) },
  'presence:subscribe': {
    payload: presenceSubscribePayloadSchema,
    ack: presenceSubscribeAckSchema,
  },
  'presence:active': { payload: presenceActivePayloadSchema, ack: z.object({}) },
} satisfies Record<string, ClientEventDefinition>;

/** Events the server emits. */
export const serverToClientEvents = {
  'message:new': messageNewEventSchema,
  'chat:updated': chatUpdatedEventSchema,
  'read:update': readUpdateEventSchema,
  'session:revoked': sessionRevokedEventSchema,
  'typing:update': typingEventSchema,
  'presence:update': presenceEventSchema,
  'presence:resubscribe': presenceResubscribeEventSchema,
  'receipt:update': receiptEventSchema,
  'message:played': messagePlayedEventSchema,
} satisfies Record<string, z.ZodType>;

type ClientEvents = typeof clientToServerEvents;
type ServerEvents = typeof serverToClientEvents;

/** Socket.IO `ClientToServerEvents` map, derived from the schemas above. */
export type ClientToServerEvents = {
  [E in keyof ClientEvents]: ClientEvents[E] extends ClientEventDefinition
    ? (
        payload: z.input<ClientEvents[E]['payload']>,
        ack: (response: AckResponse<z.output<ClientEvents[E]['ack']>>) => void,
      ) => void
    : never;
};

/** Socket.IO `ServerToClientEvents` map, derived from the schemas above. */
export type ServerToClientEvents = {
  [E in keyof ServerEvents]: ServerEvents[E] extends z.ZodType
    ? (payload: z.output<ServerEvents[E]>) => void
    : never;
};
