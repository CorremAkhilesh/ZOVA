import { z } from 'zod';
import { draftSchema } from '../rest/chats.ts';
import { chatSettingsSchema } from '../rest/settings.ts';

/** settings:updated (server → my devices): my chat settings changed on one of my devices. */
export const settingsUpdatedEventSchema = z.object({ settings: chatSettingsSchema });

/** blocks:changed (server → my devices): I blocked or unblocked someone, on one of my devices. */
export const blocksChangedEventSchema = z.object({ userId: z.string(), blocked: z.boolean() });

/** folders:updated (server → my devices): my folders changed; fetch them again. */
export const foldersUpdatedEventSchema = z.object({});

/** draft:updated (server → my devices): the draft kept for this chat now (null: none). */
export const draftUpdatedEventSchema = z.object({
  chatId: z.string(),
  draft: draftSchema.nullable(),
});
