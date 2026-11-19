import { z } from 'zod';
import { isoDateTimeSchema } from '../common/id.ts';

/**
 * The parts of a status that a chat message can carry (a reply to a status), kept apart from
 * status.ts so that chats.ts can use them without an import cycle.
 */

/** Backgrounds of a text status: ids, so a theme can draw them its own way. */
export const STATUS_BACKGROUNDS = [
  'indigo',
  'teal',
  'violet',
  'rose',
  'amber',
  'sky',
  'slate',
  'emerald',
] as const;
/** Lettering of a text status. */
export const STATUS_FONTS = ['sans', 'serif', 'mono'] as const;

export const statusKindSchema = z.enum(['text', 'image', 'video']);
export const statusStyleSchema = z.object({
  background: z.enum(STATUS_BACKGROUNDS),
  font: z.enum(STATUS_FONTS),
});

/** A reply to a status, as it shows in the 1:1 chat: a small copy of what was answered. */
export const statusReplySchema = z.object({
  statusId: z.string(),
  ownerId: z.string(),
  kind: statusKindSchema,
  text: z.string().nullable(),
  style: statusStyleSchema.nullable(),
  /** A thumbnail, while the status lasts. */
  mediaId: z.string().nullable(),
  hasThumbnail: z.boolean(),
  expiresAt: isoDateTimeSchema,
});

export type StatusKind = z.infer<typeof statusKindSchema>;
export type StatusStyle = z.infer<typeof statusStyleSchema>;
export type StatusBackground = (typeof STATUS_BACKGROUNDS)[number];
export type StatusFont = (typeof STATUS_FONTS)[number];
export type StatusReply = z.infer<typeof statusReplySchema>;
