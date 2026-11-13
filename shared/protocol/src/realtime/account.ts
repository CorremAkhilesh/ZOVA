import { z } from 'zod';
import { appearanceSchema } from '../rest/appearance.ts';
import { draftSchema } from '../rest/chats.ts';
import { pushSettingsSchema } from '../rest/push.ts';
import { quietHoursSchema } from '../rest/quiet-hours.ts';
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

/** appearance:updated (server → my devices): accent, default wallpaper or dimming changed. */
export const appearanceUpdatedEventSchema = z.object({ appearance: appearanceSchema });

/** quiet-hours:updated (server → my devices) */
export const quietHoursUpdatedEventSchema = z.object({ quietHours: quietHoursSchema });

/** push:updated (server → my devices): notification settings or my push devices changed. */
export const pushUpdatedEventSchema = z.object({ settings: pushSettingsSchema });
