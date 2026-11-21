import type { AuditAction, AuditFilter, AuditLogEntry } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { type AuditLogDoc, registerSecurityModels } from '../db/security-models.ts';
import { AppError } from '../lib/errors.ts';
import { csvCell } from './users-list.ts';

const encodeCursor = (at: Date, id: Types.ObjectId) => `${at.getTime()}_${id.toString()}`;

function decodeCursor(cursor: string | undefined) {
  const [time, id] = cursor?.split('_') ?? [];
  if (!time || !id || !Types.ObjectId.isValid(id) || !/^\d+$/.test(time)) return null;
  return { at: new Date(Number(time)), id: new Types.ObjectId(id) };
}

/**
 * The filter for the log: action, the admin's email, the person's email, a time range. Each has
 * its own index (with `at`, `_id`); the cursor continues after (at, _id).
 */
export function auditFilterOf(filter: AuditFilter, cursor?: string): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  if (filter.action) where.action = filter.action;
  if (filter.actor) where.actorEmail = filter.actor;
  if (filter.target) where.targetEmail = filter.target;
  if (filter.from || filter.to) {
    if (filter.from && filter.to && filter.from > filter.to) {
      throw new AppError('BAD_REQUEST', 'The start is after the end.', { field: 'from' });
    }
    where.at = {
      ...(filter.from ? { $gte: new Date(filter.from) } : {}),
      ...(filter.to ? { $lte: new Date(filter.to) } : {}),
    };
  }
  const after = decodeCursor(cursor);
  if (after) {
    where.$or = [{ at: { $lt: after.at } }, { at: after.at, _id: { $lt: after.id } }];
  }
  return where;
}

export const toAuditEntry = (doc: AuditLogDoc & { _id: Types.ObjectId }): AuditLogEntry => ({
  id: doc._id.toString(),
  action: doc.action as AuditAction,
  actor: { id: doc.actorId, email: doc.actorEmail },
  target: { id: doc.targetId, email: doc.targetEmail },
  ipAddress: doc.ipAddress,
  at: doc.at.toISOString(),
  reason: doc.reason ?? null,
  details: doc.details ?? null,
});

const log = (app: FastifyInstance) => registerSecurityModels(app.mongo).AuditLog;

/** Admin → Audit log, newest first, filtered, cursor on (at, _id). */
export async function listAudit(
  app: FastifyInstance,
  query: AuditFilter & { limit: number; cursor?: string | undefined },
) {
  const docs = await log(app)
    .find(auditFilterOf(query, query.cursor))
    .sort({ at: -1, _id: -1 })
    .limit(query.limit + 1)
    .lean();
  const items = docs.slice(0, query.limit);
  const last = items.at(-1);
  return {
    items: items.map(toAuditEntry),
    nextCursor: docs.length > query.limit && last ? encodeCursor(last.at, last._id) : null,
  };
}

/** The most rows one CSV holds; narrow the filter for more. */
export const AUDIT_EXPORT_MAX = 10_000;

/** GET /v1/admin/audit-log/export: the filtered log as CSV, newest first. */
export async function auditCsv(app: FastifyInstance, filter: AuditFilter): Promise<string> {
  const docs = await log(app)
    .find(auditFilterOf(filter))
    .sort({ at: -1, _id: -1 })
    .limit(AUDIT_EXPORT_MAX)
    .lean();
  const header = ['When', 'Action', 'Admin', 'Person', 'Reason', 'Details', 'IP address'];
  const lines = docs.map((doc) =>
    [
      doc.at.toISOString(),
      doc.action,
      doc.actorEmail,
      doc.targetEmail,
      doc.reason ?? null,
      doc.details ? JSON.stringify(doc.details) : null,
      doc.ipAddress,
    ]
      .map(csvCell)
      .join(','),
  );
  return `﻿${[header.map(csvCell).join(','), ...lines].join('\r\n')}\r\n`;
}
