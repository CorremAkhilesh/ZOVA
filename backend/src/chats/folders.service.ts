import { type ChatFolderDef, FOLDERS_MAX, type FolderRules } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { type FolderDoc, registerFolderModels } from '../db/folder-models.ts';
import { AppError } from '../lib/errors.ts';
import { chatModels } from './chats.service.ts';

const folders = (app: FastifyInstance) => registerFolderModels(app.mongo).Folder;
const oid = (id: string) => new Types.ObjectId(id);

const toFolder = (doc: FolderDoc): ChatFolderDef => ({
  id: doc._id.toString(),
  name: doc.name,
  emoji: doc.emoji,
  chatIds: doc.chatIds.map((id) => id.toString()),
  rules: doc.rules,
});

/** My other devices fetch my folders again. */
const announce = (app: FastifyInstance, userId: string) =>
  app.realtime.emitToUser(userId, 'folders:updated', {});

/** Only chats I am (or was) in may go in my folders. Duplicates collapse. */
async function ownChats(app: FastifyInstance, userId: string, chatIds: string[]) {
  const unique = [...new Set(chatIds)];
  if (unique.length === 0) return [];
  const mine = await chatModels(app)
    .ChatMember.find({ userId: oid(userId), chatId: { $in: unique.map(oid) } })
    .select({ chatId: 1 })
    .lean();
  if (mine.length !== unique.length) {
    throw new AppError('BAD_REQUEST', 'A folder can only hold your own chats.');
  }
  return unique.map(oid);
}

export async function listFolders(app: FastifyInstance, userId: string) {
  const docs = (await folders(app)
    .find({ userId: oid(userId) })
    .sort({ order: 1 })
    .lean()) as FolderDoc[];
  return docs.map(toFolder);
}

async function requireFolder(app: FastifyInstance, userId: string, id: string) {
  const doc = (await folders(app)
    .findOne({ _id: oid(id), userId: oid(userId) })
    .lean()) as FolderDoc | null;
  if (!doc) throw new AppError('NOT_FOUND', 'Folder not found.');
  return doc;
}

export async function createFolder(
  app: FastifyInstance,
  userId: string,
  body: { name: string; emoji: string | null; chatIds: string[]; rules: FolderRules },
) {
  const Folder = folders(app);
  const owner = oid(userId);
  const count = await Folder.countDocuments({ userId: owner });
  if (count >= FOLDERS_MAX) {
    throw new AppError('FOLDER_LIMIT_REACHED', `You can have up to ${FOLDERS_MAX} folders.`);
  }
  const chatIds = await ownChats(app, userId, body.chatIds);
  const last = await Folder.findOne({ userId: owner })
    .sort({ order: -1 })
    .select({ order: 1 })
    .lean();
  const doc = await Folder.create({
    userId: owner,
    name: body.name.trim(),
    emoji: body.emoji,
    chatIds,
    rules: body.rules,
    order: (last?.order ?? -1) + 1,
  });
  // Two creates at the same moment can both pass the count: the one over the limit undoes itself.
  if ((await Folder.countDocuments({ userId: owner })) > FOLDERS_MAX) {
    await Folder.deleteOne({ _id: doc._id });
    throw new AppError('FOLDER_LIMIT_REACHED', `You can have up to ${FOLDERS_MAX} folders.`);
  }
  announce(app, userId);
  return toFolder(doc.toObject() as FolderDoc);
}

export async function updateFolder(
  app: FastifyInstance,
  userId: string,
  id: string,
  changes: {
    name?: string | undefined;
    emoji?: string | null | undefined;
    chatIds?: string[] | undefined;
    rules?: FolderRules | undefined;
  },
) {
  await requireFolder(app, userId, id);
  const set: Record<string, unknown> = {};
  if (changes.name !== undefined) set.name = changes.name.trim();
  if (changes.emoji !== undefined) set.emoji = changes.emoji;
  if (changes.rules !== undefined) set.rules = changes.rules;
  if (changes.chatIds !== undefined) set.chatIds = await ownChats(app, userId, changes.chatIds);
  const doc = (await folders(app)
    .findOneAndUpdate(
      { _id: oid(id), userId: oid(userId) },
      { $set: set },
      { returnDocument: 'after' },
    )
    .lean()) as FolderDoc | null;
  if (!doc) throw new AppError('NOT_FOUND', 'Folder not found.');
  announce(app, userId);
  return toFolder(doc);
}

export async function deleteFolder(app: FastifyInstance, userId: string, id: string) {
  const result = await folders(app).deleteOne({ _id: oid(id), userId: oid(userId) });
  if (result.deletedCount === 0) throw new AppError('NOT_FOUND', 'Folder not found.');
  announce(app, userId);
}

/** The new order: every one of my folders, each once. */
export async function reorderFolders(app: FastifyInstance, userId: string, ids: string[]) {
  const current = await listFolders(app, userId);
  const same =
    ids.length === current.length &&
    new Set(ids).size === ids.length &&
    current.every((folder) => ids.includes(folder.id));
  if (!same) throw new AppError('BAD_REQUEST', 'Send every folder once, in the new order.');
  await folders(app).bulkWrite(
    ids.map((id, order) => ({
      updateOne: { filter: { _id: oid(id), userId: oid(userId) }, update: { $set: { order } } },
    })),
  );
  announce(app, userId);
  return listFolders(app, userId);
}
