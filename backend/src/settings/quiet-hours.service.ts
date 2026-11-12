import { DEFAULT_QUIET_HOURS, type QuietHours, quietHoursSchema } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { chatModels } from '../chats/chats.service.ts';
import { AppError } from '../lib/errors.ts';
import { usersModel } from '../users/user-record.ts';

/** The user document's own field (Better Auth's `user` collection, like chat settings). */
interface QuietHoursField {
  quietHours?: Partial<QuietHours> | null;
}

/** True when the runtime knows this IANA zone ("Asia/Kolkata"). */
export function isKnownTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/** Stored settings over the defaults; anything unreadable falls back to the defaults. */
export function toQuietHours(stored: Partial<QuietHours> | null | undefined): QuietHours {
  const parsed = quietHoursSchema.safeParse({ ...DEFAULT_QUIET_HOURS, ...(stored ?? {}) });
  return parsed.success ? parsed.data : DEFAULT_QUIET_HOURS;
}

/** My Do Not Disturb settings. Step 18 (push) reads them before notifying me. */
export async function quietHoursFor(app: FastifyInstance, userId: string): Promise<QuietHours> {
  const user = (await usersModel(app)
    .findById(new Types.ObjectId(userId))
    .select({ quietHours: 1 })
    .lean()) as QuietHoursField | null;
  return toQuietHours(user?.quietHours);
}

/** Exceptions must be chats I am in now. Anything else is refused (400), not silently dropped. */
async function assertMyChats(app: FastifyInstance, userId: string, chatIds: string[]) {
  if (chatIds.length === 0) return;
  const mine = await chatModels(app).ChatMember.countDocuments({
    userId: new Types.ObjectId(userId),
    leftAt: null,
    chatId: { $in: chatIds.map((id) => new Types.ObjectId(id)) },
  });
  if (mine !== chatIds.length) {
    throw new AppError('BAD_REQUEST', 'Some of these chats are not yours.');
  }
}

export async function setQuietHours(
  app: FastifyInstance,
  userId: string,
  input: QuietHours,
): Promise<QuietHours> {
  if (!isKnownTimezone(input.timezone)) {
    throw new AppError('BAD_REQUEST', 'Unknown time zone.', { field: 'timezone' });
  }
  const quietHours: QuietHours = {
    ...input,
    days: [...new Set(input.days)].sort((a, b) => a - b),
    allowChatIds: [...new Set(input.allowChatIds)],
  };
  await assertMyChats(app, userId, quietHours.allowChatIds);
  await usersModel(app).updateOne({ _id: new Types.ObjectId(userId) }, { $set: { quietHours } });
  app.realtime.emitToUser(userId, 'quiet-hours:updated', { quietHours });
  return quietHours;
}
