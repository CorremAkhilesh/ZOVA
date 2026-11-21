import type { AdminUserRow, adminUsersQuerySchema } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import type { z } from 'zod';
import { suspensionOf } from '../auth/policy.ts';
import { quotaBytesOf } from '../media/quota.ts';
import { devicesByUser } from '../push/admin-overview.ts';
import { escapeRegex, type UserDoc, usersModel } from '../users/user-record.ts';
import { storageByOwner, toAdminUser } from './admin.service.ts';

type ListQuery = Omit<z.infer<typeof adminUsersQuerySchema>, 'limit' | 'cursor'>;

/**
 * Admin → Users reads the whole (filtered) organization, then joins storage, devices and push and
 * sorts in memory: an organization is small, and filters like "storage 80%+" need the joins first.
 * The cap keeps a runaway query bounded.
 */
export const LIST_MAX = 5000;
/** "Storage 80%+": the share of the limit that counts as nearly full. */
export const STORAGE_HIGH_RATIO = 0.8;

/** What MongoDB can filter on: text, status and role (indexes: email, searchTerms, status, role). */
export function baseFilter({ q, filter }: ListQuery): Record<string, unknown> {
  const where: Record<string, unknown> = {};
  const text = q.trim().toLocaleLowerCase();
  if (text.includes('@')) where.email = new RegExp(`^${escapeRegex(text)}`);
  else if (text) {
    const words = text.split(/\s+/).slice(0, 5);
    where.searchTerms = { $all: words.map((word) => new RegExp(`^${escapeRegex(word)}`)) };
  }
  if (filter === 'deactivated') where.status = 'deactivated';
  if (filter === 'active' || filter === 'pushOff') where.status = { $ne: 'deactivated' };
  if (filter === 'admins') where.role = 'admin';
  // Partial index on suspendedUntil; an ended suspension is just a past date.
  if (filter === 'suspended') where.suspendedUntil = { $gt: new Date(), $type: 'date' };
  return where;
}

const latest = (...dates: Array<string | Date | null | undefined>) =>
  dates
    .filter((date): date is string | Date => Boolean(date))
    .map((date) => new Date(date).toISOString())
    .sort()
    .at(-1) ?? null;

/** Rows with storage, devices and push for `users`. */
export async function toRows(app: FastifyInstance, users: UserDoc[]): Promise<AdminUserRow[]> {
  const ids = users.map((user) => user._id);
  const [stored, devices] = await Promise.all([storageByOwner(app, ids), devicesByUser(app, ids)]);
  return users.map((user) => {
    const key = user._id.toString();
    const own = devices.get(key) ?? [];
    const suspension = suspensionOf(user);
    return {
      ...toAdminUser(user),
      storageBytes: stored.get(key) ?? 0,
      quotaBytes: quotaBytesOf(app, user),
      quotaCustom: user.storageQuotaMb !== undefined && user.storageQuotaMb !== null,
      lastActiveAt: latest(user.lastSeenAt, ...own.map((device) => device.lastActiveAt)),
      deviceCount: own.length,
      pushOn: own.some((device) => device.pushOn),
      suspendedUntil: suspension ? suspension.until.toISOString() : null,
      suspendReason: suspension ? suspension.reason : null,
    };
  });
}

const nameOf = (row: AdminUserRow) => (row.displayName ?? row.email).toLocaleLowerCase();

const SORTS: Record<ListQuery['sort'], (a: AdminUserRow, b: AdminUserRow) => number> = {
  newest: (a, b) => b.id.localeCompare(a.id),
  oldest: (a, b) => a.id.localeCompare(b.id),
  name: (a, b) => nameOf(a).localeCompare(nameOf(b)) || a.id.localeCompare(b.id),
  // Never seen: last.
  lastActive: (a, b) =>
    (b.lastActiveAt ?? '').localeCompare(a.lastActiveAt ?? '') || b.id.localeCompare(a.id),
  storage: (a, b) => b.storageBytes - a.storageBytes || b.id.localeCompare(a.id),
};

/** Everyone matching the query, sorted. Index: `_id` order, narrowed by email/searchTerms/status/role. */
export async function matchingRows(app: FastifyInstance, query: ListQuery) {
  const users = (await usersModel(app)
    .find(baseFilter(query))
    .sort({ _id: -1 })
    .limit(LIST_MAX)
    .lean()) as UserDoc[];
  let rows = await toRows(app, users);
  if (query.filter === 'pushOff') rows = rows.filter((row) => !row.pushOn);
  if (query.filter === 'storageHigh') {
    rows = rows.filter((row) => row.storageBytes >= row.quotaBytes * STORAGE_HIGH_RATIO);
  }
  return rows.sort(SORTS[query.sort]);
}

/** GET /v1/admin/users: one page; the cursor is the last row's id in this order. */
export async function listUsersPage(
  app: FastifyInstance,
  query: ListQuery & { limit: number; cursor?: string | undefined },
) {
  const rows = await matchingRows(app, query);
  let start = 0;
  if (query.cursor) {
    const at = Types.ObjectId.isValid(query.cursor)
      ? rows.findIndex((row) => row.id === query.cursor)
      : -1;
    // The person the page ended on is gone from this view: nothing safe to continue from.
    if (at < 0) return { items: [], nextCursor: null };
    start = at + 1;
  }
  const items = rows.slice(start, start + query.limit);
  const more = start + query.limit < rows.length;
  return { items, nextCursor: more ? (items.at(-1)?.id ?? null) : null };
}

/** A spreadsheet cell: quoted, and never read as a formula (=, +, -, @ at the start). */
export function csvCell(value: string | number | boolean | null): string {
  const text = value === null ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

const MB = 1024 * 1024;
const CSV_HEADER = [
  'Name',
  'Email',
  'Username',
  'Role',
  'Status',
  'Joined',
  'Last sign-in',
  'Last active',
  'Devices',
  'Notifications',
  'Suspended until',
  'Storage used (MB)',
  'Storage limit (MB)',
];

/** GET /v1/admin/users/export: the same people as the list, every page, as CSV. */
export function usersCsv(rows: AdminUserRow[]): string {
  const lines = rows.map((row) =>
    [
      row.displayName,
      row.email,
      row.username,
      row.role,
      row.status,
      row.createdAt,
      row.lastLoginAt,
      row.lastActiveAt,
      row.deviceCount,
      row.pushOn ? 'on' : 'off',
      row.suspendedUntil,
      Math.round(row.storageBytes / MB),
      Math.round(row.quotaBytes / MB),
    ]
      .map(csvCell)
      .join(','),
  );
  // A byte-order mark so Excel reads names in Hindi correctly.
  return `﻿${[CSV_HEADER.map(csvCell).join(','), ...lines].join('\r\n')}\r\n`;
}
