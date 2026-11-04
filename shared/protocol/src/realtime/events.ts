import { z } from 'zod';
import type { AckResponse } from './ack.ts';
import {
  chatUpdatedEventSchema,
  messageNewEventSchema,
  presenceEventSchema,
  readUpdateAckSchema,
  readUpdateEventSchema,
  readUpdatePayloadSchema,
  receiptEventSchema,
  sendMessageAckSchema,
  sendMessagePayloadSchema,
  sessionRevokedEventSchema,
  typingEventSchema,
  typingPayloadSchema,
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
  // Reserved for Step 10.
  'typing:start': { payload: typingPayloadSchema, ack: z.object({}) },
  'typing:stop': { payload: typingPayloadSchema, ack: z.object({}) },
} satisfies Record<string, ClientEventDefinition>;

/** Events the server emits. */
export const serverToClientEvents = {
  'message:new': messageNewEventSchema,
  'chat:updated': chatUpdatedEventSchema,
  'read:update': readUpdateEventSchema,
  'session:revoked': sessionRevokedEventSchema,
  // Reserved for Step 10.
  'typing:update': typingEventSchema,
  'presence:update': presenceEventSchema,
  'receipt:update': receiptEventSchema,
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
