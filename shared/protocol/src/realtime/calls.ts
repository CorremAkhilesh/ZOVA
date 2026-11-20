import { z } from 'zod';
import { objectIdSchema } from '../common/id.ts';
import { callKindSchema, callViewSchema } from '../rest/calls.ts';

/**
 * Call signaling over the socket. The server checks every event (member, block, flag, who is in the
 * call) and passes offers, answers and ICE candidates only between the caller's device and the one
 * device that answered, never to anyone else.
 */

const SDP_MAX = 20_000;

/** WebRTC signaling between the two devices in a call. */
export const callSignalSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('offer'), sdp: z.string().min(1).max(SDP_MAX) }),
  z.object({ type: z.literal('answer'), sdp: z.string().min(1).max(SDP_MAX) }),
  z.object({
    type: z.literal('candidate'),
    candidate: z.string().max(2000),
    sdpMid: z.string().max(64).nullable(),
    sdpMLineIndex: z.number().int().min(0).max(64).nullable(),
  }),
  /** The callee lost the connection: asks the caller for an ICE restart (a new offer). */
  z.object({ type: z.literal('restart') }),
]);
export type CallSignal = z.infer<typeof callSignalSchema>;

export const callStartPayloadSchema = z.object({ chatId: objectIdSchema, kind: callKindSchema });
/** `busy`: the other person is on another call; the call is already over (and logged). */
export const callStartAckSchema = z.object({ call: callViewSchema, busy: z.boolean() });

export const callIdPayloadSchema = z.object({ callId: objectIdSchema });
export const callAcceptAckSchema = z.object({ call: callViewSchema });

export const callSignalPayloadSchema = z.object({
  callId: objectIdSchema,
  signal: callSignalSchema,
});

/** To every device of the person called. `silent`: their quiet hours: show, but do not ring. */
export const callIncomingEventSchema = z.object({ call: callViewSchema, silent: z.boolean() });
/** To both people's devices whenever the call changes (ringing, answered, ended). */
export const callUpdateEventSchema = z.object({ call: callViewSchema });
/** To the other device in the call only. */
export const callSignalEventSchema = callSignalPayloadSchema;
