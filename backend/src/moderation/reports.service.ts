import {
  type CreateReportBody,
  REPORT_RECENT_MESSAGES,
  type ReportEvidence,
  type ReportTarget,
} from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import { chatModels } from '../chats/chats.service.ts';
import { hiddenIds } from '../chats/history.service.ts';
import { canSeeSeq, requireParticipant, visibleSeqs } from '../chats/visibility.ts';
import type { ChatMemberDoc, MessageDoc } from '../db/chat-models.ts';
import { AppError } from '../lib/errors.ts';
import { type UserDoc, usersModel } from '../users/user-record.ts';
import { blockUser, moderationModels } from './blocks.service.ts';

/** More than this in an hour is abuse of the report button, not reporting. */
export const REPORTS_PER_HOUR = 20;
const oid = (id: string) => new Types.ObjectId(id);

async function assertReportLimit(app: FastifyInstance, reporterId: string) {
  const recent = await moderationModels(app).Report.countDocuments({
    reporterId: oid(reporterId),
    createdAt: { $gt: new Date(Date.now() - 3_600_000) },
  });
  if (recent >= REPORTS_PER_HOUR) {
    throw new AppError('RATE_LIMITED', 'You have sent many reports. Try again later.');
  }
}

/** The person's latest messages in this chat that I can see. */
async function recentFrom(
  app: FastifyInstance,
  member: ChatMemberDoc,
  reporterId: string,
  senderId: Types.ObjectId | null,
) {
  const seq = visibleSeqs(member);
  return chatModels(app)
    .Message.find({
      chatId: member.chatId,
      ...(Object.keys(seq).length ? { seq } : {}),
      _id: { $nin: await hiddenIds(app, reporterId, member.chatId.toString()) },
      ...(senderId ? { senderId } : { type: { $ne: 'system' } }),
    })
    .sort({ seq: -1 })
    .limit(REPORT_RECENT_MESSAGES)
    .lean();
}

async function evidenceOf(app: FastifyInstance, docs: MessageDoc[], selected: Set<string>) {
  const senders = [...new Set(docs.flatMap((doc) => (doc.senderId ? [doc.senderId] : [])))];
  const users = (await usersModel(app)
    .find({ _id: { $in: senders } })
    .select({ displayName: 1, email: 1 })
    .lean()) as UserDoc[];
  const names = new Map(users.map((user) => [user._id.toString(), user.displayName ?? user.email]));
  return docs
    .sort((a, b) => a.seq - b.seq)
    .map(
      (doc): ReportEvidence => ({
        messageId: doc._id.toString(),
        chatId: doc.chatId.toString(),
        seq: doc.seq,
        senderId: doc.senderId?.toString() ?? null,
        senderName: doc.senderId ? (names.get(doc.senderId.toString()) ?? 'Unknown') : 'System',
        type: doc.type,
        text: doc.deletedForEveryoneAt ? null : doc.text,
        fileName: doc.deletedForEveryoneAt ? null : (doc.media?.name ?? null),
        selected: selected.has(doc._id.toString()),
        createdAt: doc.createdAt.toISOString(),
      }),
    );
}

/** Who is reported, and copies of what the reporter saw: only messages they may see. */
async function gather(app: FastifyInstance, reporterId: string, target: ReportTarget) {
  if (target.kind === 'user') {
    if (target.userId === reporterId)
      throw new AppError('BAD_REQUEST', 'You cannot report yourself.');
    const exists = await usersModel(app).exists({ _id: oid(target.userId) });
    if (!exists) throw new AppError('NOT_FOUND', 'User not found.');
    if (!target.chatId) return { reportedId: target.userId, docs: [], selected: new Set<string>() };
    const member = await requireParticipant(app, target.chatId, reporterId);
    const docs = await recentFrom(app, member, reporterId, oid(target.userId));
    return { reportedId: target.userId, docs, selected: new Set<string>() };
  }
  const member = await requireParticipant(app, target.chatId, reporterId);
  if (target.kind === 'group') {
    const chat = await chatModels(app).Chat.findById(target.chatId).select({ type: 1 }).lean();
    if (chat?.type !== 'group') throw new AppError('BAD_REQUEST', 'This chat is not a group.');
    return {
      reportedId: null,
      docs: await recentFrom(app, member, reporterId, null),
      selected: new Set<string>(),
    };
  }
  const hidden = new Set((await hiddenIds(app, reporterId, target.chatId)).map(String));
  const picked = (
    await chatModels(app)
      .Message.find({ chatId: oid(target.chatId), _id: { $in: target.messageIds.map(oid) } })
      .lean()
  ).filter((doc) => canSeeSeq(member, doc.seq) && !hidden.has(doc._id.toString()));
  const sender = picked.find((doc) => doc.senderId)?.senderId ?? null;
  if (picked.length === 0 || !sender) throw new AppError('NOT_FOUND', 'Message not found.');
  if (sender.toString() === reporterId) {
    throw new AppError('BAD_REQUEST', 'You cannot report your own messages.');
  }
  const recent = await recentFrom(app, member, reporterId, sender);
  const byId = new Map([...picked, ...recent].map((doc) => [doc._id.toString(), doc]));
  return {
    reportedId: sender.toString(),
    docs: [...byId.values()],
    selected: new Set(picked.map((doc) => doc._id.toString())),
  };
}

/** Report a person, messages or a group, and optionally block the person too. */
export async function createReport(
  app: FastifyInstance,
  reporterId: string,
  body: CreateReportBody & { block: boolean },
) {
  await assertReportLimit(app, reporterId);
  const { reportedId, docs, selected } = await gather(app, reporterId, body.target);
  const evidence = await evidenceOf(app, docs, selected);
  const blocked = Boolean(body.block && reportedId);
  const report = await moderationModels(app).Report.create({
    reporterId: oid(reporterId),
    target: body.target,
    reason: body.reason,
    note: body.note?.trim() || null,
    evidence,
    blocked,
    status: 'open',
    resolution: null,
    resolvedBy: null,
    resolvedAt: null,
    createdAt: new Date(),
  });
  if (blocked && reportedId) await blockUser(app, reporterId, reportedId);
  return { reportId: report._id.toString(), blocked };
}

/** Who a report is about: the person, or the sender of the reported messages. */
export const reportedUserId = (report: { target: ReportTarget; evidence: ReportEvidence[] }) => {
  if (report.target.kind === 'user') return report.target.userId;
  if (report.target.kind === 'group') return null;
  return report.evidence.find((item) => item.selected && item.senderId)?.senderId ?? null;
};
