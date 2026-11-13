import type { ReportSummary } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { type Actor, audit, findTarget } from '../admin/admin.service.ts';
import { setUserStatus } from '../admin/user-status.ts';
import { chatModels } from '../chats/chats.service.ts';
import type { ReportDoc } from '../db/moderation-models.ts';
import { AppError } from '../lib/errors.ts';
import { type UserDoc, usersModel } from '../users/user-record.ts';
import { moderationModels } from './blocks.service.ts';
import { reportedUserId } from './reports.service.ts';

const person = (user: UserDoc | undefined, id: string) => ({
  id,
  displayName: user?.displayName ?? user?.email ?? 'Unknown',
  email: user?.email ?? '',
  status: user?.status === 'deactivated' ? ('deactivated' as const) : ('active' as const),
});

/** Turns reports into rows, with one query each for people and groups. */
async function summaries(app: FastifyInstance, reports: ReportDoc[]): Promise<ReportSummary[]> {
  const userIds = new Set<string>();
  const groupIds = new Set<string>();
  for (const report of reports) {
    userIds.add(report.reporterId.toString());
    const reported = reportedUserId(report);
    if (reported) userIds.add(reported);
    if (report.target.kind === 'group') groupIds.add(report.target.chatId);
  }
  const users = (await usersModel(app)
    .find({ _id: { $in: [...userIds].map((id) => new Types.ObjectId(id)) } })
    .lean()) as UserDoc[];
  const userById = new Map(users.map((user) => [user._id.toString(), user]));
  const groups = await chatModels(app)
    .Chat.find({ _id: { $in: [...groupIds].map((id) => new Types.ObjectId(id)) } })
    .select({ group: 1 })
    .lean();
  const groupName = new Map(groups.map((chat) => [chat._id.toString(), chat.group?.name ?? '']));
  return reports.map((report) => {
    const reported = reportedUserId(report);
    const reporter = report.reporterId.toString();
    return {
      id: report._id.toString(),
      status: report.status,
      kind: report.target.kind,
      reason: report.reason,
      note: report.note,
      blocked: report.blocked,
      reporter: person(userById.get(reporter), reporter),
      reported: reported ? person(userById.get(reported), reported) : null,
      group:
        report.target.kind === 'group'
          ? { id: report.target.chatId, name: groupName.get(report.target.chatId) ?? '' }
          : null,
      evidenceCount: report.evidence.length,
      createdAt: report.createdAt.toISOString(),
      resolvedAt: report.resolvedAt?.toISOString() ?? null,
      resolution: report.resolution,
    };
  });
}

function decodeCursor(cursor: string | undefined) {
  if (!cursor) return null;
  const [time, id] = cursor.split('_');
  if (!time || !id || !/^\d+$/.test(time) || !Types.ObjectId.isValid(id)) {
    throw new AppError('BAD_REQUEST', 'Invalid cursor.');
  }
  return { at: new Date(Number(time)), id: new Types.ObjectId(id) };
}

/** Admin → Reports, newest first, optionally only open or resolved ones. */
export async function listReports(
  app: FastifyInstance,
  query: { status?: 'open' | 'resolved' | undefined; cursor?: string | undefined; limit: number },
) {
  const after = decodeCursor(query.cursor);
  const docs = (await moderationModels(app)
    .Report.find({
      ...(query.status ? { status: query.status } : {}),
      ...(after
        ? {
            $or: [
              { createdAt: { $lt: after.at } },
              { createdAt: after.at, _id: { $lt: after.id } },
            ],
          }
        : {}),
    })
    .sort({ createdAt: -1, _id: -1 })
    .limit(query.limit + 1)
    .lean()) as ReportDoc[];
  const page = docs.slice(0, query.limit);
  const last = page.at(-1);
  return {
    items: await summaries(app, page),
    nextCursor:
      docs.length > query.limit && last
        ? `${last.createdAt.getTime()}_${last._id.toString()}`
        : null,
  };
}

async function findReport(app: FastifyInstance, id: string) {
  const report = (await moderationModels(app).Report.findById(id).lean()) as ReportDoc | null;
  if (!report) throw new AppError('NOT_FOUND', 'Report not found.');
  return report;
}

/** The person an audit entry about this report names. */
const auditTarget = (app: FastifyInstance, report: ReportDoc) =>
  findTarget(app, reportedUserId(report) ?? report.reporterId.toString());

/** One report with its evidence. Reading private messages is itself audited. */
export async function viewReport(app: FastifyInstance, actor: Actor, id: string) {
  const report = await findReport(app, id);
  await audit(app, actor, 'report.view', await auditTarget(app, report));
  const [summary] = await summaries(app, [report]);
  if (!summary) throw new AppError('NOT_FOUND', 'Report not found.');
  return { ...summary, evidence: report.evidence };
}

/** Closes a report; `deactivate` also deactivates the person reported, through the usual checks. */
export async function resolveReport(
  app: FastifyInstance,
  actor: Actor,
  id: string,
  body: { action: 'none' | 'deactivate'; note?: string | undefined },
) {
  const report = await findReport(app, id);
  if (report.status === 'resolved')
    throw new AppError('CONFLICT', 'This report is already resolved.');
  if (body.action === 'deactivate') {
    const reported = reportedUserId(report);
    if (!reported) throw new AppError('BAD_REQUEST', 'This report is not about a person.');
    await setUserStatus(app, actor, reported, 'deactivated');
  }
  const resolution = {
    action: body.action === 'deactivate' ? ('deactivated' as const) : ('none' as const),
    note: body.note?.trim() || null,
  };
  await moderationModels(app).Report.updateOne(
    { _id: report._id, status: 'open' },
    {
      $set: {
        status: 'resolved',
        resolution,
        resolvedBy: new Types.ObjectId(actor.id),
        resolvedAt: new Date(),
      },
    },
  );
  await audit(app, actor, 'report.resolve', await auditTarget(app, report));
  const [summary] = await summaries(app, [await findReport(app, id)]);
  if (!summary) throw new AppError('NOT_FOUND', 'Report not found.');
  return summary;
}
