import type { MediaInfo } from '@zuvo/protocol';
import { Schema, type Types } from 'mongoose';

const options = { versionKey: false, autoCreate: true } as const;
const { ObjectId } = Schema.Types;

export interface MediaDoc {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  kind: MediaInfo['kind'];
  mime: string;
  size: number;
  /** As the user named it: shown and offered on download, and never used on disk. */
  name: string;
  width: number | null;
  height: number | null;
  duration: number | null;
  waveform?: number[] | null;
  sha256: string | null;
  storageKey: string | null;
  thumbnailKey: string | null;
  placeholder: string | null;
  status: 'pending' | 'ready' | 'failed';
  /** Set once, when attached to a message. */
  messageId: Types.ObjectId | null;
  chatId: Types.ObjectId | null;
  createdAt: Date;
}

export const mediaSchema = new Schema<MediaDoc>(
  {
    ownerId: { type: ObjectId, required: true },
    kind: { type: String, required: true },
    mime: { type: String, required: true },
    size: { type: Number, required: true },
    name: { type: String, required: true },
    width: { type: Number, default: null },
    height: { type: Number, default: null },
    duration: { type: Number, default: null },
    waveform: { type: [Number], default: undefined },
    sha256: { type: String, default: null },
    storageKey: { type: String, default: null },
    thumbnailKey: { type: String, default: null },
    placeholder: { type: String, default: null },
    status: { type: String, required: true, default: 'pending' },
    messageId: { type: ObjectId, default: null },
    chatId: { type: ObjectId, default: null },
    createdAt: { type: Date, default: () => new Date() },
  },
  { ...options, collection: 'media' },
);
// Serves: how many uploads a person has open (the per-user limit).
mediaSchema.index({ ownerId: 1, status: 1, createdAt: -1 });
// Serves: Admin → Users, how much each person stores. Holds `size`, so no document is read.
mediaSchema.index({ ownerId: 1, status: 1, size: 1 });
// Serves: the hourly cleanup of uploads never attached to a message.
mediaSchema.index({ messageId: 1, createdAt: 1 });

/** When someone's position moved, so "Read by" can say when. Reads as far as they were shareable. */
export interface ReceiptEventDoc {
  chatId: Types.ObjectId;
  userId: Types.ObjectId;
  kind: 'delivered' | 'read';
  seq: number;
  at: Date;
}

export const RECEIPT_EVENT_TTL_DAYS = 90;

export const receiptEventSchema = new Schema<ReceiptEventDoc>(
  {
    chatId: { type: ObjectId, required: true },
    userId: { type: ObjectId, required: true },
    kind: { type: String, required: true },
    seq: { type: Number, required: true },
    at: { type: Date, required: true },
  },
  { ...options, collection: 'receipt_events' },
);
// Serves: message info. The first event at or past a message's position is when it got there.
receiptEventSchema.index({ chatId: 1, seq: 1 });
// Older times are not worth keeping forever: the lists then show who, without when.
receiptEventSchema.index({ at: 1 }, { expireAfterSeconds: RECEIPT_EVENT_TTL_DAYS * 86_400 });
