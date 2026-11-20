import { type CallOutcome, type CallView, callSystemValue } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { chatModels } from '../chats/chats.service.ts';
import { appendSystemMessage, deliverSystemMessage, namesOf } from '../chats/group-core.ts';
import { type CallDoc, registerCallModels } from '../db/call-models.ts';
import { pushCall } from './call-push.ts';

export const callModels = (app: FastifyInstance) => registerCallModels(app.mongo);

export function toCallView(doc: CallDoc): CallView {
  const iso = (date: Date | null) => (date ? date.toISOString() : null);
  return {
    id: doc._id.toString(),
    chatId: doc.chatId.toString(),
    kind: doc.kind,
    callerId: doc.callerId.toString(),
    calleeId: doc.calleeId.toString(),
    status: doc.status,
    outcome: doc.outcome,
    startedAt: doc.startedAt.toISOString(),
    ringingAt: iso(doc.ringingAt),
    answeredAt: iso(doc.answeredAt),
    endedAt: iso(doc.endedAt),
  };
}

export const durationSeconds = (doc: Pick<CallDoc, 'answeredAt' | 'endedAt'>) =>
  doc.answeredAt && doc.endedAt
    ? Math.max(0, Math.round((doc.endedAt.getTime() - doc.answeredAt.getTime()) / 1000))
    : 0;

/** Every device of both people (the caller's alone for a call that never rang). */
export function announceCall(app: FastifyInstance, doc: CallDoc, callerOnly = false) {
  const call = toCallView(doc);
  app.realtime.emitToUser(doc.callerId.toString(), 'call:update', { call });
  if (!callerOnly) app.realtime.emitToUser(doc.calleeId.toString(), 'call:update', { call });
}

/** Missed in the callee's eyes: rang (or would have) and nobody picked up. */
const MISSED: ReadonlySet<CallOutcome> = new Set(['missed', 'cancelled', 'busy']);

/**
 * The call's line in the chat ("Voice call · 2:31", "Missed voice call"), for both people. The caller
 * has read it (they made the call), and so has the callee when they answered or declined: only a
 * missed call is unread for them.
 */
async function appendCallLine(app: FastifyInstance, doc: CallDoc) {
  const outcome = doc.outcome ?? 'failed';
  const callerId = doc.callerId.toString();
  const calleeId = doc.calleeId.toString();
  const names = await namesOf(app, [callerId, calleeId]);
  const readers = MISSED.has(outcome) ? [doc.callerId] : [doc.callerId, doc.calleeId];
  const stored = await app.mongo.transaction((session) =>
    appendSystemMessage(
      app,
      session,
      doc.chatId,
      {
        kind: 'call',
        actor: names(callerId),
        targets: [names(calleeId)],
        value: callSystemValue(doc.kind, outcome, durationSeconds(doc)),
      },
      {
        apply: async (seq) => {
          await chatModels(app).ChatMember.updateMany(
            { chatId: doc.chatId, userId: { $in: readers }, lastReadSeq: { $lt: seq } },
            { $set: { lastReadSeq: seq } },
            { session },
          );
        },
      },
    ),
  );
  deliverSystemMessage(app, stored);
}

/** After a call ends: tell both, write its line in the chat, and a missed-call notification. */
export async function afterCallEnded(app: FastifyInstance, doc: CallDoc) {
  app.callTimers.clear(doc._id.toString());
  announceCall(app, doc, doc.outcome === 'busy');
  try {
    await appendCallLine(app, doc);
  } catch (error) {
    app.log.error({ err: error, callId: doc._id.toString() }, 'call line could not be written');
  }
  if (doc.outcome && MISSED.has(doc.outcome)) {
    await pushCall(app, doc, 'missed', false).catch((error: unknown) =>
      app.log.warn({ err: error }, 'missed call push failed'),
    );
  }
}

/**
 * Ends a call that is still `doc.status`, once: of two devices ending it together, one wins and the
 * other finds it over. Returns the ended call, or null when it had already changed.
 */
export async function finishCall(
  app: FastifyInstance,
  doc: Pick<CallDoc, '_id' | 'status'>,
  outcome: CallOutcome,
  endedAt = new Date(),
): Promise<CallDoc | null> {
  const ended = await callModels(app)
    .Call.findOneAndUpdate(
      { _id: doc._id, status: doc.status },
      { $set: { status: 'ended', outcome, endedAt } },
      { returnDocument: 'after' },
    )
    .lean();
  if (!ended) return null;
  await afterCallEnded(app, ended);
  return ended;
}
