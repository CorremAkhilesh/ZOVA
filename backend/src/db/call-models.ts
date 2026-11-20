import type { CallKind, CallOutcome, CallStatus } from '@zuvo/protocol';
import { type Connection, type Model, Schema, type Types } from 'mongoose';

const options = { versionKey: false, autoCreate: true } as const;
const { ObjectId } = Schema.Types;

/**
 * One call: who, when and how it ended. Never its sound: media goes peer to peer (or through TURN)
 * and is never stored. The session ids say which device of each person signals, so offers and ICE
 * candidates reach exactly that device.
 */
export interface CallDoc {
  _id: Types.ObjectId;
  chatId: Types.ObjectId;
  kind: CallKind;
  callerId: Types.ObjectId;
  calleeId: Types.ObjectId;
  /** Both people: the call history and "already on a call" read this (multikey). */
  userIds: Types.ObjectId[];
  callerSessionId: string;
  /** The device that answered. */
  answeredSessionId: string | null;
  status: CallStatus;
  outcome: CallOutcome | null;
  startedAt: Date;
  ringingAt: Date | null;
  answeredAt: Date | null;
  endedAt: Date | null;
  /** Last sign of life from a device in the call (see CALL_STALE_SECONDS). */
  lastBeatAt: Date;
}

const callSchema = new Schema<CallDoc>(
  {
    chatId: { type: ObjectId, required: true },
    kind: { type: String, required: true },
    callerId: { type: ObjectId, required: true },
    calleeId: { type: ObjectId, required: true },
    userIds: { type: [ObjectId], required: true },
    callerSessionId: { type: String, required: true },
    answeredSessionId: { type: String, default: null },
    status: { type: String, required: true },
    outcome: { type: String, default: null },
    startedAt: { type: Date, required: true },
    ringingAt: { type: Date, default: null },
    answeredAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },
    lastBeatAt: { type: Date, required: true },
  },
  { ...options, collection: 'calls' },
);
// Serves: my call history, newest first, by cursor (userIds equality, then _id sort/range).
callSchema.index({ userIds: 1, _id: -1 });
// Serves: whether someone is already on a call, and my ringing or current call (userIds and status
// equality).
callSchema.index({ userIds: 1, status: 1 });

export function registerCallModels(connection: Connection) {
  const model = <T>(name: string, schema: Schema<T>): Model<T> =>
    (connection.models[name] as Model<T> | undefined) ?? connection.model<T>(name, schema);
  return { Call: model('Call', callSchema) };
}
