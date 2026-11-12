import {
  type Appearance,
  appearanceSchema,
  DEFAULT_APPEARANCE,
  type Wallpaper,
} from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { announceOwnChat } from '../chats/chat-prefs.service.ts';
import { chatModels } from '../chats/chats.service.ts';
import { logUpdates } from '../chats/updates.ts';
import { requireParticipant } from '../chats/visibility.ts';
import { registerAppearanceModels } from '../db/appearance-models.ts';
import { AppError } from '../lib/errors.ts';
import { usersModel } from '../users/user-record.ts';

export const appearanceModels = (app: FastifyInstance) => registerAppearanceModels(app.mongo);
export const oidOf = (id: string) => new Types.ObjectId(id);

/** The user document's own field (Better Auth's `user` collection, like chat settings). */
interface AppearanceField {
  appearance?: Partial<Appearance> | null;
}

export function toAppearance(stored: Partial<Appearance> | null | undefined): Appearance {
  const parsed = appearanceSchema.safeParse({ ...DEFAULT_APPEARANCE, ...(stored ?? {}) });
  return parsed.success ? parsed.data : DEFAULT_APPEARANCE;
}

export async function getAppearance(app: FastifyInstance, userId: string): Promise<Appearance> {
  const user = (await usersModel(app)
    .findById(oidOf(userId))
    .select({ appearance: 1 })
    .lean()) as AppearanceField | null;
  return toAppearance(user?.appearance);
}

/** A picture wallpaper must be one of mine. Someone else's id looks like one that does not exist. */
export async function assertMyWallpaper(
  app: FastifyInstance,
  userId: string,
  wallpaper: Wallpaper,
) {
  if (wallpaper.kind !== 'image') return;
  const mine = await appearanceModels(app).WallpaperImage.exists({
    _id: oidOf(wallpaper.id),
    userId: oidOf(userId),
  });
  if (!mine) throw new AppError('NOT_FOUND', 'Wallpaper not found.');
}

async function saveAppearance(app: FastifyInstance, userId: string, appearance: Appearance) {
  await usersModel(app).updateOne({ _id: oidOf(userId) }, { $set: { appearance } });
  app.realtime.emitToUser(userId, 'appearance:updated', { appearance });
  return appearance;
}

export async function updateAppearance(
  app: FastifyInstance,
  userId: string,
  changes: { [K in keyof Appearance]?: Appearance[K] | undefined },
): Promise<Appearance> {
  if (changes.wallpaper) await assertMyWallpaper(app, userId, changes.wallpaper);
  const current = await getAppearance(app, userId);
  const defined = Object.fromEntries(
    Object.entries(changes).filter(([, value]) => value !== undefined),
  ) as Partial<Appearance>;
  return saveAppearance(app, userId, { ...current, ...defined });
}

/** Records a change to my own view of these chats, then tells my devices about each one. */
async function setMemberWallpapers(
  app: FastifyInstance,
  userId: string,
  memberIds: Types.ObjectId[],
  chatIds: Types.ObjectId[],
  wallpaper: Wallpaper | null,
) {
  if (memberIds.length === 0) return new Map<string, string>();
  const models = chatModels(app);
  const now = new Date();
  return app.mongo.transaction(async (session) => {
    await models.ChatMember.updateMany(
      { _id: { $in: memberIds } },
      { $set: { wallpaper } },
      { session },
    );
    let cursors = new Map<string, string>();
    for (const chatId of chatIds) {
      cursors = await logUpdates(models, session, [oidOf(userId)], { kind: 'chat', chatId }, now);
    }
    return cursors;
  });
}

/** This chat's own wallpaper, for me only; null goes back to my default. */
export async function setChatWallpaper(
  app: FastifyInstance,
  userId: string,
  chatId: string,
  wallpaper: Wallpaper | null,
) {
  const member = await requireParticipant(app, chatId, userId);
  if (wallpaper) await assertMyWallpaper(app, userId, wallpaper);
  const cursors = await setMemberWallpapers(app, userId, [member._id], [member.chatId], wallpaper);
  return announceOwnChat(app, userId, chatId, cursors.get(userId) ?? '0');
}

/** A deleted picture leaves no wallpaper behind: my default and my chats go back to the default. */
export async function forgetWallpaperImage(app: FastifyInstance, userId: string, imageId: string) {
  const current = await getAppearance(app, userId);
  if (current.wallpaper.kind === 'image' && current.wallpaper.id === imageId) {
    await saveAppearance(app, userId, { ...current, wallpaper: DEFAULT_APPEARANCE.wallpaper });
  }
  const members = await chatModels(app)
    .ChatMember.find({ userId: oidOf(userId), 'wallpaper.kind': 'image', 'wallpaper.id': imageId })
    .select({ _id: 1, chatId: 1 })
    .lean();
  const cursors = await setMemberWallpapers(
    app,
    userId,
    members.map((member) => member._id),
    members.map((member) => member.chatId),
    null,
  );
  // Each chat is announced once; the last cursor covers every change logged above.
  const cursor = cursors.get(userId) ?? '0';
  for (const member of members) {
    await announceOwnChat(app, userId, member.chatId.toString(), cursor);
  }
}
