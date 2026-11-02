import { z } from 'zod';

/** A MongoDB ObjectId as a 24-character hex string. */
export const objectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Invalid id')
  .transform((id) => id.toLowerCase());

export type ObjectId = z.infer<typeof objectIdSchema>;

/** An ISO 8601 date-time string with offset — the only date format sent over the wire. */
export const isoDateTimeSchema = z.iso.datetime({ offset: true });

export type IsoDateTime = z.infer<typeof isoDateTimeSchema>;

/** Serializes a Date for transport. */
export function toIsoDateTime(date: Date): IsoDateTime {
  return date.toISOString();
}

/** Parses a transported date-time string back into a Date. */
export function fromIsoDateTime(value: IsoDateTime): Date {
  return new Date(value);
}
