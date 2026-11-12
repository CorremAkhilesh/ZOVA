import { z } from 'zod';
import { objectIdSchema } from '../common/id.ts';

export const FOLDERS_MAX = 10;
export const FOLDER_CHATS_MAX = 200;
export const FOLDER_NAME_MAX = 24;

/** Which chats a folder takes in by itself, besides the ones picked. */
export const folderRulesSchema = z.object({
  /** Every group. */
  groups: z.boolean(),
  /** Every 1:1 chat. */
  direct: z.boolean(),
  /** Every chat with something unread. */
  unread: z.boolean(),
  /** Leave out muted chats (that were not picked). */
  excludeMuted: z.boolean(),
  /** Leave out archived chats (that were not picked). */
  excludeArchived: z.boolean(),
});
export const NO_FOLDER_RULES: FolderRules = {
  groups: false,
  direct: false,
  unread: false,
  excludeMuted: false,
  excludeArchived: true,
};

/** One emoji (with its modifiers and joiners), or none. */
export const folderEmojiSchema = z
  .string()
  .max(16)
  .regex(/^\p{Extended_Pictographic}(?:\p{Emoji_Modifier}|️|‍\p{Extended_Pictographic})*$/u)
  .nullable();

/** A chat folder of my own. Mine alone, on all my devices. */
export const chatFolderSchema = z.object({
  id: z.string(),
  name: z.string(),
  emoji: folderEmojiSchema,
  chatIds: z.array(z.string()),
  rules: folderRulesSchema,
});

/** GET /v1/me/folders — in my order. */
export const foldersResponseSchema = z.object({ folders: z.array(chatFolderSchema) });

const folderFields = {
  name: z.string().trim().min(1).max(FOLDER_NAME_MAX),
  emoji: folderEmojiSchema,
  chatIds: z.array(objectIdSchema).max(FOLDER_CHATS_MAX),
  rules: folderRulesSchema,
};
/** POST /v1/me/folders */
export const createFolderBodySchema = z.object({
  ...folderFields,
  emoji: folderEmojiSchema.default(null),
  chatIds: folderFields.chatIds.default([]),
  rules: folderRulesSchema.default(NO_FOLDER_RULES),
});
/** PATCH /v1/me/folders/:id — any of the fields. */
export const updateFolderBodySchema = z
  .object(folderFields)
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update');
export const folderParamsSchema = z.object({ id: objectIdSchema });
/** PUT /v1/me/folders/order — every folder id, in the new order. */
export const reorderFoldersBodySchema = z.object({
  ids: z.array(objectIdSchema).max(FOLDERS_MAX),
});

export type FolderRules = z.infer<typeof folderRulesSchema>;
export type ChatFolderDef = z.infer<typeof chatFolderSchema>;
