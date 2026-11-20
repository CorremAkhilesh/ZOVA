import {
  CALL_RING_SECONDS,
  CALL_STALE_SECONDS,
  type CallKind,
  type CallSignal,
  type CallView,
} from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import type { CallDoc } from '../db/call-models.ts';
import { AppError } from '../lib/errors.ts';
import { sessionRoom } from '../realtime/server.ts';
import { afterCallEnded, announceCall, callModels, finishCall, toCallView } from './call-finish.ts';
import { pushCall, quietFor } from './call-push.ts';
import { assertMayCall } from './call-rules.ts';

/** Call attempts per person per minute. */
export const CALL_START_LIMIT = { max: 10, windowSeconds: 60 };

const oid = (id: string) => new Types.ObjectId(id);
const notFound = () => new AppError('NOT_FOUND', 'Call not found.');

/** A ringing call past its time, or a call no device has spoken for: over, whatever the timers did. */
function staleOutcome(doc: CallDoc, now: number) {
  if (doc.status === 'ringing' && now - doc.startedAt.getTime() > (CALL_RING_SECONDS + 15) * 1000) {
    return { outcome: 'missed' as const, endedAt: new Date(now) };
  }
  if (doc.status === 'active' && now - doc.lastBeatAt.getTime() > CALL_STALE_SECONDS * 1000) {
    return { outcome: 'answered' as const, endedAt: doc.lastBeatAt };
  }
  return null;
}

/** The call this person is ringing in or talking on, if any. Stale ones are ended on the way. */
export async function liveCallOf(app: FastifyInstance, userId: string): Promise<CallDoc | null> {
  const docs = await callModels(app)
    .Call.find({ userIds: oid(userId), status: { $in: ['ringing', 'active'] } })
    .lean();
  const now = Date.now();
  let live: CallDoc | null = null;
  for (const doc of docs) {
    const stale = staleOutcome(doc, now);
    if (stale) await finishCall(app, doc, stale.outcome, stale.endedAt);
    else live ??= doc;
  }
  return live;
}

async function assertStartLimit(app: FastifyInstance, userId: string) {
  const key = `zuvo:rate:call:${userId}`;
  const count = await app.counterStore.increment(key, CALL_START_LIMIT.windowSeconds);
  if (count > CALL_START_LIMIT.max) {
    throw new AppError('RATE_LIMITED', 'Too many calls. Try again in a minute.', {
      retryAfterSeconds: Math.max(1, await app.counterStore.ttl(key)),
    });
  }
}

export interface StartInput {
  userId: string;
  sessionId: string;
  chatId: string;
  kind: CallKind;
}

/**
 * Starts a call: rings every device of the other person (and a push where the app is not open), or,
 * when they are already on a call, ends it at once as `busy` (a missed call for them).
 */
export async function startCall(
  app: FastifyInstance,
  input: StartInput,
): Promise<{ call: CallView; busy: boolean }> {
  await assertStartLimit(app, input.userId);
  const peerId = await assertMayCall(app, input.userId, input.chatId);
  if (await liveCallOf(app, input.userId)) {
    throw new AppError('CALL_IN_PROGRESS', 'You are already on a call.');
  }
  const busy = (await liveCallOf(app, peerId)) !== null;
  const now = new Date();
  const doc: CallDoc = {
    _id: new Types.ObjectId(),
    chatId: oid(input.chatId),
    kind: input.kind,
    callerId: oid(input.userId),
    calleeId: oid(peerId),
    userIds: [oid(input.userId), oid(peerId)],
    callerSessionId: input.sessionId,
    answeredSessionId: null,
    status: busy ? 'ended' : 'ringing',
    outcome: busy ? 'busy' : null,
    startedAt: now,
    ringingAt: null,
    answeredAt: null,
    endedAt: busy ? now : null,
    lastBeatAt: now,
  };
  await callModels(app).Call.insertMany([doc]);
  if (busy) {
    await afterCallEnded(app, doc);
    return { call: toCallView(doc), busy: true };
  }
  const silent = await quietFor(app, peerId, input.chatId);
  app.realtime.emitToUser(peerId, 'call:incoming', { call: toCallView(doc), silent });
  void pushCall(app, doc, 'incoming', silent).catch((error: unknown) =>
    app.log.warn({ err: error }, 'incoming call push failed'),
  );
  app.callTimers.schedule(doc._id.toString(), CALL_RING_SECONDS * 1000, () =>
    finishCall(app, doc, 'missed'),
  );
  return { call: toCallView(doc), busy: false };
}

/** A call of mine, by id. Anyone else's is "not found". */
async function myCall(app: FastifyInstance, userId: string, callId: string): Promise<CallDoc> {
  const doc = await callModels(app).Call.findById(callId).lean();
  if (!doc?.userIds.some((id) => id.toString() === userId)) throw notFound();
  return doc;
}

/** A device of the person called shows the call: the caller now hears "Ringing…". */
export async function markRinging(app: FastifyInstance, userId: string, callId: string) {
  const doc = await callModels(app)
    .Call.findOneAndUpdate(
      { _id: oid(callId), calleeId: oid(userId), status: 'ringing', ringingAt: null },
      { $set: { ringingAt: new Date() } },
      { returnDocument: 'after' },
    )
    .lean();
  if (doc) announceCall(app, doc, true);
}

/** Answers on this device. Every other device stops ringing. */
export async function acceptCall(
  app: FastifyInstance,
  userId: string,
  sessionId: string,
  callId: string,
): Promise<{ call: CallView }> {
  const now = new Date();
  const doc = await callModels(app)
    .Call.findOneAndUpdate(
      { _id: oid(callId), calleeId: oid(userId), status: 'ringing' },
      {
        $set: { status: 'active', answeredSessionId: sessionId, answeredAt: now, lastBeatAt: now },
      },
      { returnDocument: 'after' },
    )
    .lean();
  if (!doc) {
    const existing = await myCall(app, userId, callId);
    if (existing.calleeId.toString() !== userId) throw notFound();
    throw new AppError('CONFLICT', 'This call is no longer ringing.');
  }
  app.callTimers.clear(callId);
  if (!doc.ringingAt) doc.ringingAt = now;
  announceCall(app, doc);
  return { call: toCallView(doc) };
}

/** Declining, cancelling and hanging up: how it ends depends on who and when. Twice is harmless. */
export async function endCall(
  app: FastifyInstance,
  userId: string,
  callId: string,
  how: 'decline' | 'end',
) {
  const doc = await myCall(app, userId, callId);
  if (doc.status === 'ended') return;
  const isCaller = doc.callerId.toString() === userId;
  if (doc.status === 'active') {
    if (how === 'end') await finishCall(app, doc, 'answered');
    return;
  }
  await finishCall(app, doc, isCaller ? 'cancelled' : 'declined');
}

/** A device in the call is still there. */
export async function beat(app: FastifyInstance, userId: string, callId: string) {
  await callModels(app).Call.updateOne(
    { _id: oid(callId), userIds: oid(userId), status: 'active' },
    { $set: { lastBeatAt: new Date() } },
  );
}

/**
 * Passes an offer, answer or ICE candidate to the other device in the call, and to no one else: only
 * between the caller's device and the one that answered, and only while the call is on.
 */
export async function relaySignal(
  app: FastifyInstance,
  from: { userId: string; sessionId: string },
  callId: string,
  signal: CallSignal,
) {
  const doc = await myCall(app, from.userId, callId);
  if (doc.status !== 'active' || !doc.answeredSessionId) {
    throw new AppError('CONFLICT', 'This call is not connected.');
  }
  const isCallerDevice =
    doc.callerId.toString() === from.userId && doc.callerSessionId === from.sessionId;
  const isCalleeDevice =
    doc.calleeId.toString() === from.userId && doc.answeredSessionId === from.sessionId;
  if (!isCallerDevice && !isCalleeDevice) {
    throw new AppError('FORBIDDEN', 'This call is on another device.');
  }
  const to = isCallerDevice ? doc.answeredSessionId : doc.callerSessionId;
  app.realtime.io.to(sessionRoom(to)).emit('call:signal', { callId, signal });
}

/** My ringing or current call, for a device that just opened (from a notification, say). */
export async function activeCall(app: FastifyInstance, userId: string): Promise<CallView | null> {
  const doc = await liveCallOf(app, userId);
  return doc ? toCallView(doc) : null;
}
