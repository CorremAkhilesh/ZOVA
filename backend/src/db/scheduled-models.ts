import type { MediaInfo, Mention, ScheduledFailure } from '@zuvo/protocol';
import { type Connection, type Model, Schema, type Types } from 'mongoose';

const options = { versionKey: false, autoCreate: true } as const;
const { ObjectId } = Schema.Types;

/** How long a sent one is kept (it is no longer listed) before MongoDB removes it. */
export const SCHEDULED_SENT_TTL_DAYS = 7;

export type ScheduledStatus = 'pending' | 'sending' | 'sent' | 'failed';

/** A message of mine waiting to be sent at `sendAt`, even while I am offline. */
export interface ScheduledDoc {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  chatId: Types.ObjectId;
  /** The text, or the caption on media. */
  text: string | null;
  /** A finished upload of mine, attached only when it is sent. */
  mediaId: Types.ObjectId | null;
  /** What the app shows meanwhile, copied from the upload. */
  media: MediaInfo | null;
  mentions?: Mention[];
  mentionsEveryone?: boolean;
  sendAt: Date;
  status: ScheduledStatus;
  failure: ScheduledFailure | null;
  messageId: Types.ObjectId | null;
  /** Fixed at creation: sending twice (a retry) stores the message once. */
  clientMsgId: string;
  /** How many times a send was started. */
  attempts: number;
  /** When the current send started: one stuck for long is tried again. */
  claimedAt: Date | null;
  /** When it was sent: MongoDB removes it a week later. */
  doneAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const scheduledSchema = new Schema<ScheduledDoc>(
  {
    userId: { type: ObjectId, required: true },
    chatId: { type: ObjectId, required: true },
    text: { type: String, default: null },
    mediaId: { type: ObjectId, default: null },
    media: { type: Schema.Types.Mixed, default: null },
    mentions: { type: [Schema.Types.Mixed], default: undefined },
    mentionsEveryone: { type: Boolean, default: undefined },
    sendAt: { type: Date, required: true },
    status: { type: String, required: true, default: 'pending' },
    failure: { type: String, default: null },
    messageId: { type: ObjectId, default: null },
    clientMsgId: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    claimedAt: { type: Date, default: null },
    doneAt: { type: Date, default: undefined },
    createdAt: { type: Date, default: () => new Date() },
    updatedAt: { type: Date, default: () => new Date() },
  },
  { ...options, collection: 'scheduled_messages' },
);
// Serves: the runner's sweep of due items (`pending`, sendAt <= now, soonest first) and of sends
// stuck in `sending`.
scheduledSchema.index({ status: 1, sendAt: 1 });
// Serves: my list (status in pending/sending/failed, soonest first, optionally one chat), how many
// I have waiting (the limit of 50), and each one by id with its owner.
scheduledSchema.index({ userId: 1, status: 1, sendAt: 1 });
// Serves: whether an upload is waiting in a scheduled message (orphan cleanup; scheduling it twice).
// Partial: most have no file.
scheduledSchema.index(
  { mediaId: 1, status: 1 },
  { partialFilterExpression: { mediaId: { $type: 'objectId' } } },
);
// Serves: removing sent ones a week later. Partial: only sent ones have `doneAt`.
scheduledSchema.index(
  { doneAt: 1 },
  {
    expireAfterSeconds: SCHEDULED_SENT_TTL_DAYS * 86_400,
    partialFilterExpression: { doneAt: { $type: 'date' } },
  },
);

export function registerScheduledModels(connection: Connection) {
  const model = <T>(name: string, schema: Schema<T>): Model<T> =>
    (connection.models[name] as Model<T> | undefined) ?? connection.model<T>(name, schema);
  return { Scheduled: model('ScheduledMessage', scheduledSchema) };
}
