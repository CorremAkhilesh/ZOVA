import { randomUUID } from 'node:crypto';
import {
  type AdminAnnouncement,
  ANNOUNCEMENT_MAX_DAYS,
  type AnnouncementBanner,
  type createAnnouncementBodySchema,
} from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import { Types } from 'mongoose';
import type { z } from 'zod';
import { getOrCreateDirectChat } from '../chats/chats.service.ts';
import { sendMessage } from '../chats/messages.service.ts';
import { type AnnouncementDoc, registerAnnouncementModels } from '../db/announcement-models.ts';
import { AppError } from '../lib/errors.ts';
import { type UserDoc, usersModel } from '../users/user-record.ts';
import { type Actor, audit } from './admin.service.ts';

type CreateBody = z.output<typeof createAnnouncementBodySchema>;
const models = (app: FastifyInstance) => registerAnnouncementModels(app.mongo);
const DAY_MS = 86_400_000;

const running = (doc: AnnouncementDoc, now: Date) =>
  doc.endedAt === null && (doc.endsAt === null || doc.endsAt > now);

export function toAdminAnnouncement(doc: AnnouncementDoc, now = new Date()): AdminAnnouncement {
  return {
    id: doc._id.toString(),
    title: doc.title,
    body: doc.body,
    level: doc.level,
    endsAt: doc.endsAt?.toISOString() ?? null,
    audience: doc.audience,
    recipients: doc.recipients,
    banner: doc.banner,
    message: doc.message,
    createdAt: doc.createdAt.toISOString(),
    createdBy: doc.createdBy.email,
    endedAt: doc.endedAt?.toISOString() ?? null,
    state: doc.banner && running(doc, now) ? 'active' : 'ended',
  };
}

/** Everyone active, or the chosen people who are; never the admin sending it. */
async function recipientsOf(app: FastifyInstance, actor: Actor, body: CreateBody) {
  const filter: Record<string, unknown> = { status: { $ne: 'deactivated' } };
  if (body.audience.kind === 'some') {
    filter._id = { $in: body.audience.userIds.map((id) => new Types.ObjectId(id)) };
  }
  const users = (await usersModel(app).find(filter).select({ _id: 1 }).lean()) as UserDoc[];
  return users.filter((user) => user._id.toString() !== actor.id);
}

/** The chat message: the title on its own line, then the text. */
export const announcementText = (title: string, body: string) => `📢 ${title}\n\n${body}`;

/**
 * POST /v1/admin/announcements. The banner shows at once for its audience; the messages go out one
 * by one in the background (a few seconds for a whole organization). Audited.
 */
export async function createAnnouncement(
  app: FastifyInstance,
  actor: Actor,
  body: CreateBody,
  now = new Date(),
): Promise<AdminAnnouncement> {
  if (body.banner && body.endsAt) {
    const ends = Date.parse(body.endsAt);
    if (ends <= now.getTime() || ends > now.getTime() + ANNOUNCEMENT_MAX_DAYS * DAY_MS) {
      throw new AppError('BAD_REQUEST', `Choose an end within ${ANNOUNCEMENT_MAX_DAYS} days.`, {
        field: 'endsAt',
      });
    }
  }
  const people = await recipientsOf(app, actor, body);
  if (people.length === 0) throw new AppError('BAD_REQUEST', 'Nobody to send this to.');
  const doc = await models(app).Announcement.create({
    title: body.title,
    body: body.body,
    level: body.level,
    audience: body.audience.kind,
    userIds: body.audience.kind === 'some' ? people.map((user) => user._id) : [],
    recipients: people.length,
    banner: body.banner,
    message: body.message,
    endsAt: body.banner && body.endsAt ? new Date(body.endsAt) : null,
    endedAt: body.banner ? null : now,
    createdBy: { id: actor.id, email: actor.email },
    createdAt: now,
  });
  await audit(
    app,
    actor,
    'announcement.create',
    { _id: new Types.ObjectId(actor.id), email: actor.email },
    {
      reason: body.reason,
      details: {
        title: body.title,
        audience: body.audience.kind,
        recipients: people.length,
        banner: body.banner ? 'yes' : 'no',
        message: body.message ? 'yes' : 'no',
      },
    },
  );
  if (body.message) {
    const text = announcementText(body.title, body.body);
    void (async () => {
      for (const user of people) {
        const chat = await getOrCreateDirectChat(app, actor.id, user._id.toString());
        await sendMessage(app, {
          userId: actor.id,
          chatId: chat.id,
          clientMsgId: randomUUID(),
          text,
        });
      }
    })().catch((error: unknown) => app.log.error({ err: error }, 'announcement messages failed'));
  }
  return toAdminAnnouncement(doc.toObject(), now);
}

/** Admin → Announcements, newest first, cursor on _id (default index). */
export async function listAnnouncements(app: FastifyInstance, limit: number, cursor?: string) {
  const filter =
    cursor && Types.ObjectId.isValid(cursor) ? { _id: { $lt: new Types.ObjectId(cursor) } } : {};
  const docs = await models(app)
    .Announcement.find(filter)
    .sort({ _id: -1 })
    .limit(limit + 1)
    .lean();
  const items = docs.slice(0, limit);
  return {
    items: items.map((doc) => toAdminAnnouncement(doc)),
    nextCursor: docs.length > limit ? (items.at(-1)?._id.toString() ?? null) : null,
  };
}

/** Takes a banner down for everyone now. Audited. */
export async function endAnnouncement(
  app: FastifyInstance,
  actor: Actor,
  id: string,
  reason: string,
) {
  const doc = Types.ObjectId.isValid(id)
    ? await models(app).Announcement.findById(id).lean()
    : null;
  if (!doc) throw new AppError('NOT_FOUND', 'Announcement not found.');
  const at = doc.endedAt ?? new Date();
  if (!doc.endedAt) {
    await models(app).Announcement.updateOne({ _id: doc._id }, { $set: { endedAt: at } });
    await audit(
      app,
      actor,
      'announcement.end',
      { _id: new Types.ObjectId(actor.id), email: actor.email },
      {
        reason,
        details: { title: doc.title },
      },
    );
  }
  return toAdminAnnouncement({ ...doc, endedAt: at });
}

/**
 * GET /v1/announcements: the banners for me now: running (index: running_banners), for everyone or
 * naming me, and not closed by me (index: userId + announcementId).
 */
export async function bannersFor(app: FastifyInstance, userId: string, now = new Date()) {
  const { Announcement, AnnouncementDismissal } = models(app);
  const docs = await Announcement.find({ banner: true, endedAt: null })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  const me = new Types.ObjectId(userId);
  const mine = docs.filter(
    (doc) =>
      running(doc, now) && (doc.audience === 'all' || doc.userIds.some((id) => id.equals(me))),
  );
  const closed = mine.length
    ? await AnnouncementDismissal.find({
        userId: me,
        announcementId: { $in: mine.map((doc) => doc._id) },
      })
        .select({ announcementId: 1 })
        .lean()
    : [];
  const gone = new Set(closed.map((row) => row.announcementId.toString()));
  const items: AnnouncementBanner[] = mine
    .filter((doc) => !gone.has(doc._id.toString()))
    .map((doc) => ({
      id: doc._id.toString(),
      title: doc.title,
      body: doc.body,
      level: doc.level,
      endsAt: doc.endsAt?.toISOString() ?? null,
    }));
  return { items };
}

/** I closed a banner: it stays closed for me on every device. */
export async function dismissBanner(app: FastifyInstance, userId: string, id: string) {
  const exists = Types.ObjectId.isValid(id) && (await models(app).Announcement.exists({ _id: id }));
  if (!exists) throw new AppError('NOT_FOUND', 'Announcement not found.');
  await models(app).AnnouncementDismissal.updateOne(
    { userId: new Types.ObjectId(userId), announcementId: new Types.ObjectId(id) },
    { $setOnInsert: { at: new Date() } },
    { upsert: true },
  );
  return { ok: true as const };
}
