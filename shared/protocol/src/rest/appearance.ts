import { z } from 'zod';

/** Lowercase ObjectId hex. No transform: these schemas are also used to serialize responses. */
const idSchema = z.string().regex(/^[0-9a-f]{24}$/, 'Invalid id');

/** Six accents, each checked for AA contrast in light and dark (see @zuvo/ui-tokens). */
export const accentSchema = z.enum(['indigo', 'teal', 'violet', 'rose', 'amber', 'sky']);
export const WALLPAPER_PATTERNS = ['dots', 'grid', 'waves', 'leaves', 'confetti', 'none'] as const;
export const WALLPAPER_COLORS = ['mist', 'sand', 'sage', 'blush', 'sky', 'slate'] as const;
export const WALLPAPER_MAX_BYTES = 10 * 1024 * 1024;
/** Each person keeps at most this many of their own pictures. */
export const WALLPAPER_IMAGES_MAX = 10;
export const DIM_MAX = 80;

export const wallpaperSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('pattern'), id: z.enum(WALLPAPER_PATTERNS) }),
  z.object({ kind: z.literal('color'), id: z.enum(WALLPAPER_COLORS) }),
  /** One of my uploaded pictures: GET /v1/me/wallpapers/:id. */
  z.object({ kind: z.literal('image'), id: idSchema }),
]);

export const appearanceSchema = z.object({
  accent: accentSchema,
  /** For every chat without its own. */
  wallpaper: wallpaperSchema,
  /** Percent darker in the dark theme, so text stays readable on bright pictures. */
  dim: z.number().int().min(0).max(DIM_MAX),
});
export const DEFAULT_APPEARANCE: Appearance = {
  accent: 'indigo',
  wallpaper: { kind: 'pattern', id: 'dots' },
  dim: 30,
};

/** GET /v1/me/appearance · PATCH (any subset) · appearance:updated (server → my devices) */
export const appearanceResponseSchema = z.object({ appearance: appearanceSchema });
export const updateAppearanceBodySchema = appearanceSchema
  .partial()
  .refine((body) => Object.keys(body).length > 0, 'Nothing to update');

/** PUT /v1/chats/:id/wallpaper: this chat's own, or null for the default. Mine alone. */
export const chatWallpaperBodySchema = z.object({ wallpaper: wallpaperSchema.nullable() });

/** POST /v1/me/wallpapers (multipart `file`) · GET /v1/me/wallpapers */
export const wallpaperImageSchema = z.object({ id: z.string(), url: z.string() });
export const wallpaperImageResponseSchema = z.object({ image: wallpaperImageSchema });
export const wallpaperImagesResponseSchema = z.object({ images: z.array(wallpaperImageSchema) });

export type Accent = z.infer<typeof accentSchema>;
export type Wallpaper = z.infer<typeof wallpaperSchema>;
export type Appearance = z.infer<typeof appearanceSchema>;
