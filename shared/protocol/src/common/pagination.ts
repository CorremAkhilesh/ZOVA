import { z } from 'zod';

export const PAGE_LIMIT_DEFAULT = 50;
export const PAGE_LIMIT_MAX = 100;

/** Query for cursor-based pagination. `cursor` is opaque to clients. */
export const cursorPageQuerySchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(PAGE_LIMIT_MAX).default(PAGE_LIMIT_DEFAULT),
});

export type CursorPageQuery = z.infer<typeof cursorPageQuerySchema>;

/** Wraps an item schema in a page response. `nextCursor` is null on the last page. */
export function cursorPageSchema<Item extends z.ZodType>(item: Item) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().min(1).nullable(),
  });
}

export type CursorPage<Item> = {
  items: Item[];
  nextCursor: string | null;
};
