import type { ClientSession, Types } from 'mongoose';
import type { ChatModels, UserUpdateDoc } from '../db/chat-models.ts';

export type UpdateInput = Pick<UserUpdateDoc, 'kind' | 'chatId' | 'seq'>;

/**
 * Gives each user their next change number and logs the change, inside the caller's transaction.
 *
 * Incrementing the counter locks that user's counter document until commit, so a user's numbers
 * become visible strictly in order: nobody can read number 6 while number 5 is still uncommitted.
 * That is what makes "everything after my cursor" free of gaps (docs/protocol.md).
 *
 * Returns each user's new number as a sync cursor. Takes a constant number of round trips however
 * many members a chat has.
 */
export async function logUpdates(
  models: ChatModels,
  session: ClientSession,
  userIds: Types.ObjectId[],
  update: UpdateInput,
  at: Date,
): Promise<Map<string, string>> {
  const sorted = [...userIds].sort((a, b) => a.toString().localeCompare(b.toString()));
  await models.UserSync.bulkWrite(
    sorted.map((id) => ({
      updateOne: { filter: { _id: id }, update: { $inc: { seq: 1 } }, upsert: true },
    })),
    { session, ordered: true },
  );
  const counters = await models.UserSync.find({ _id: { $in: sorted } })
    .session(session)
    .lean();
  await models.UserUpdate.insertMany(
    counters.map((counter) => ({ ...update, userId: counter._id, pts: counter.seq, at })),
    { session, ordered: true },
  );
  return new Map(counters.map((counter) => [counter._id.toString(), String(counter.seq)]));
}
