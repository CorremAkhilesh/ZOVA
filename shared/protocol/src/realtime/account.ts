import { z } from 'zod';
import { chatSettingsSchema } from '../rest/settings.ts';

/** settings:updated (server → my devices): my chat settings changed on one of my devices. */
export const settingsUpdatedEventSchema = z.object({ settings: chatSettingsSchema });
