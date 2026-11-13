import { z } from 'zod';

/** Mine alone, on every device: how my chat list behaves. */
export const chatSettingsSchema = z.object({
  /** On: an archived chat stays archived when new messages arrive. Off: a new message brings it back. */
  keepChatsArchived: z.boolean(),
});
export const DEFAULT_CHAT_SETTINGS: ChatSettings = { keepChatsArchived: true };

/** PATCH /v1/me/chat-settings — any subset. */
export const updateChatSettingsBodySchema = chatSettingsSchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update');

/** GET/PATCH /v1/me/chat-settings, and the `settings:updated` event. */
export const chatSettingsResponseSchema = z.object({ settings: chatSettingsSchema });

export type ChatSettings = z.infer<typeof chatSettingsSchema>;
