import type { z } from 'zod';
import type { AckResponse } from './ack.ts';

/** A client → server event: its payload schema and the schema of the ack data it returns. */
export interface ClientEventDefinition {
  payload: z.ZodType;
  ack: z.ZodType;
}

/**
 * Events the client emits. Filled in feature by feature, e.g.
 * `'message:send': { payload: sendMessageSchema, ack: messageSchema }`.
 */
export const clientToServerEvents = {} satisfies Record<string, ClientEventDefinition>;

/**
 * Events the server emits. Filled in feature by feature, e.g.
 * `'message:new': messageSchema`.
 */
export const serverToClientEvents = {} satisfies Record<string, z.ZodType>;

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
