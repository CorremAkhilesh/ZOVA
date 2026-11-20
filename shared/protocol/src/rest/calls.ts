import { z } from 'zod';
import { isoDateTimeSchema, objectIdSchema } from '../common/id.ts';

/**
 * Calls (Part 1: 1:1 voice). Media never touches the server: it goes peer to peer, or through a TURN
 * relay. The server keeps a small record of each call (who, when, how it ended) and passes the
 * WebRTC signaling between the two devices. Video and group calls add kinds and members later.
 */

/** Ids in responses: plain strings (a response schema cannot hold a transform). */
const idString = z.string().min(1);

/** An unanswered call stops ringing after this long and becomes a missed call. */
export const CALL_RING_SECONDS = 45;
/** Each device in a call says it is still there this often. */
export const CALL_BEAT_SECONDS = 15;
/** A call no device has spoken for in this long is over (a crashed tab, a lost phone). */
export const CALL_STALE_SECONDS = 60;

export const callKindSchema = z.enum(['voice']);
export type CallKind = z.infer<typeof callKindSchema>;

export const callStatusSchema = z.enum(['ringing', 'active', 'ended']);
export type CallStatus = z.infer<typeof callStatusSchema>;

/**
 * How a call ended. `missed`: nobody answered in time. `cancelled`: the caller hung up first.
 * `busy`: the other person was already on a call. `failed`: the connection could not be kept.
 */
export const callOutcomeSchema = z.enum([
  'answered',
  'missed',
  'declined',
  'busy',
  'cancelled',
  'failed',
]);
export type CallOutcome = z.infer<typeof callOutcomeSchema>;

/** A call as both people see it. */
export const callViewSchema = z.object({
  id: idString,
  chatId: idString,
  kind: callKindSchema,
  callerId: idString,
  calleeId: idString,
  status: callStatusSchema,
  outcome: callOutcomeSchema.nullable(),
  startedAt: isoDateTimeSchema,
  /** A device of the person called has it on screen. */
  ringingAt: isoDateTimeSchema.nullable(),
  answeredAt: isoDateTimeSchema.nullable(),
  endedAt: isoDateTimeSchema.nullable(),
});
export type CallView = z.infer<typeof callViewSchema>;

/** GET /v1/calls/access: whether this account may make calls (the call buttons). */
export const callAccessResponseSchema = z.object({ enabled: z.boolean() });

/** One RTCIceServer. TURN entries carry time-limited credentials (TURN REST API). */
export const iceServerSchema = z.object({
  urls: z.array(z.string().min(1)).min(1),
  username: z.string().optional(),
  credential: z.string().optional(),
});
export type IceServer = z.infer<typeof iceServerSchema>;

/** GET /v1/calls/ice: STUN, and TURN when the server has one. */
export const iceResponseSchema = z.object({
  iceServers: z.array(iceServerSchema),
  /** The TURN credentials stop working after this long (0 without TURN). */
  ttlSeconds: z.number().int().nonnegative(),
});
export type IceResponse = z.infer<typeof iceResponseSchema>;

/** GET /v1/calls/active: a call that is ringing for me or that I am in, if any. */
export const activeCallResponseSchema = z.object({ call: callViewSchema.nullable() });

export const callLogQuerySchema = z.object({
  /** The `nextCursor` of the previous page. */
  before: objectIdSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** A line of my call history. The person is the chat's other member: the app names them. */
export const callLogEntrySchema = z.object({
  id: idString,
  chatId: idString,
  peerId: idString,
  kind: callKindSchema,
  direction: z.enum(['incoming', 'outgoing']),
  outcome: callOutcomeSchema,
  startedAt: isoDateTimeSchema,
  durationSeconds: z.number().int().nonnegative(),
});
export type CallLogEntry = z.infer<typeof callLogEntrySchema>;

export const callLogResponseSchema = z.object({
  items: z.array(callLogEntrySchema),
  nextCursor: idString.nullable(),
});

/**
 * The value of a call's line in the chat (system event kind `call`): `voice:answered:151` (seconds)
 * or `voice:missed`, `voice:declined`… Kept short and stable: old apps show whatever they can.
 */
export function callSystemValue(kind: CallKind, outcome: CallOutcome, seconds: number): string {
  return outcome === 'answered' ? `${kind}:answered:${seconds}` : `${kind}:${outcome}`;
}

export function parseCallSystemValue(
  value: string | null,
): { kind: CallKind; outcome: CallOutcome; seconds: number } | null {
  const [kind, outcome, seconds] = (value ?? '').split(':');
  const parsedKind = callKindSchema.safeParse(kind);
  const parsedOutcome = callOutcomeSchema.safeParse(outcome);
  if (!parsedKind.success || !parsedOutcome.success) return null;
  const count = Number(seconds ?? 0);
  return {
    kind: parsedKind.data,
    outcome: parsedOutcome.data,
    seconds: Number.isFinite(count) && count > 0 ? Math.floor(count) : 0,
  };
}

/** "2:31", "1:02:05". */
export function formatCallDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
