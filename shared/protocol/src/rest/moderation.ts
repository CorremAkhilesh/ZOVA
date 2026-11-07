import { z } from 'zod';
import { isoDateTimeSchema, objectIdSchema } from '../common/id.ts';
import { cursorPageQuerySchema, cursorPageSchema } from '../common/pagination.ts';
import { messageTypeSchema } from './chats.ts';
import { publicProfileSchema } from './profile.ts';

// Blocks ---------------------------------------------------------------------------------------

/** PUT/DELETE /v1/me/blocks/:userId */
export const blockParamsSchema = z.object({ userId: objectIdSchema });
export const blockResponseSchema = z.object({ userId: z.string(), blocked: z.boolean() });

/** GET /v1/me/blocks — everyone I blocked, newest first. Short, so one page. */
export const blockedContactSchema = z.object({
  user: publicProfileSchema,
  blockedAt: isoDateTimeSchema,
});
export const blockedContactsResponseSchema = z.object({ items: z.array(blockedContactSchema) });

// Reports --------------------------------------------------------------------------------------

export const REPORT_NOTE_MAX = 500;
export const REPORT_MESSAGES_MAX = 20;
/** How many of the person's latest messages in that chat go with a report. */
export const REPORT_RECENT_MESSAGES = 5;

export const reportReasonSchema = z.enum([
  'spam',
  'harassment',
  'hate',
  'violence',
  'sexual',
  'scam',
  'impersonation',
  'other',
]);

/** What is reported. `chatId` on a person: the chat their latest messages are taken from. */
export const reportTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), userId: objectIdSchema, chatId: objectIdSchema.optional() }),
  z.object({
    kind: z.literal('message'),
    chatId: objectIdSchema,
    messageIds: z.array(objectIdSchema).min(1).max(REPORT_MESSAGES_MAX),
  }),
  z.object({ kind: z.literal('group'), chatId: objectIdSchema }),
]);

/** POST /v1/reports */
export const createReportBodySchema = z.object({
  target: reportTargetSchema,
  reason: reportReasonSchema,
  note: z.string().trim().max(REPORT_NOTE_MAX).optional(),
  /** Report and block: the reported person (or the sender of the reported messages). */
  block: z.boolean().default(false),
});
export const createReportResponseSchema = z.object({
  reportId: z.string(),
  blocked: z.boolean(),
});

/** A copy of one message, as the reporter could see it when reporting. Only admins read these. */
export const reportEvidenceSchema = z.object({
  messageId: z.string(),
  chatId: z.string(),
  seq: z.number().int().positive(),
  senderId: z.string().nullable(),
  senderName: z.string(),
  type: messageTypeSchema,
  text: z.string().nullable(),
  /** File name of a document, or null. The file itself is not copied. */
  fileName: z.string().nullable(),
  /** The reporter picked this one; the others are the person's latest messages. */
  selected: z.boolean(),
  createdAt: isoDateTimeSchema,
});

const reportPersonSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  email: z.string(),
  status: z.enum(['active', 'deactivated']),
});

export const reportStatusSchema = z.enum(['open', 'resolved']);

/** Admin → Reports: one row. */
export const reportSummarySchema = z.object({
  id: z.string(),
  status: reportStatusSchema,
  kind: z.enum(['user', 'message', 'group']),
  reason: reportReasonSchema,
  note: z.string().nullable(),
  blocked: z.boolean(),
  reporter: reportPersonSchema,
  /** The person reported (or who sent the reported messages). Null for a group. */
  reported: reportPersonSchema.nullable(),
  group: z.object({ id: z.string(), name: z.string() }).nullable(),
  evidenceCount: z.number().int().nonnegative(),
  createdAt: isoDateTimeSchema,
  resolvedAt: isoDateTimeSchema.nullable(),
  resolution: z
    .object({ action: z.enum(['none', 'deactivated']), note: z.string().nullable() })
    .nullable(),
});

/** GET /v1/admin/reports?status=&cursor=&limit= */
export const reportListQuerySchema = cursorPageQuerySchema.extend({
  status: reportStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});
export const reportListResponseSchema = cursorPageSchema(reportSummarySchema);

/** GET /v1/admin/reports/:id — with the evidence. Viewing it is audited. */
export const reportParamsSchema = z.object({ id: objectIdSchema });
export const reportDetailResponseSchema = z.object({
  report: reportSummarySchema.extend({ evidence: z.array(reportEvidenceSchema) }),
});

/** POST /v1/admin/reports/:id/resolve */
export const resolveReportBodySchema = z.object({
  action: z.enum(['none', 'deactivate']),
  note: z.string().trim().max(REPORT_NOTE_MAX).optional(),
});

export type ReportReason = z.infer<typeof reportReasonSchema>;
export type ReportTarget = z.infer<typeof reportTargetSchema>;
export type ReportEvidence = z.infer<typeof reportEvidenceSchema>;
export type ReportSummary = z.infer<typeof reportSummarySchema>;
export type BlockedContact = z.infer<typeof blockedContactSchema>;
export type CreateReportBody = z.input<typeof createReportBodySchema>;
