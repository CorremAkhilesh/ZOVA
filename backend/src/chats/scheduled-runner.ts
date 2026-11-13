import type { ScheduledFailure, ScheduledMessage } from '@zuvo/protocol';
import { Queue, Worker } from 'bullmq';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import type { ScheduledDoc } from '../db/scheduled-models.ts';
import { AppError } from '../lib/errors.ts';
import { createBullConnection } from '../lib/redis.ts';
import { usersModel } from '../users/user-record.ts';
import { chatModels, oid } from './chats.service.ts';
import { sendMessage } from './messages.service.ts';
import {
  announceScheduled,
  noJobs,
  ownScheduled,
  type ScheduledJobs,
  scheduledModels,
  toScheduled,
} from './scheduled.service.ts';

/** How often MongoDB is checked for due ones: the safety net, and the only timer without Redis. */
export const SWEEP_MS = 15_000;
/** A send this old that never finished (a crash, a lost connection) is tried again: it is idempotent. */
export const STUCK_MS = 2 * 60_000;
/** After this many starts, it fails instead of trying again. */
const MAX_ATTEMPTS = 5;
const SWEEP_BATCH = 50;
const QUEUE = 'scheduled-messages';

type Logger = Pick<FastifyInstance['log'], 'info' | 'warn' | 'error'>;

/** Why a send was refused, in the words the app shows. Every rule is the one sendMessage applies. */
async function failureOf(
  app: FastifyInstance,
  doc: ScheduledDoc,
  error: AppError,
): Promise<ScheduledFailure> {
  switch (error.code) {
    case 'NOT_FOUND':
      return 'not_member';
    case 'BLOCKED':
    case 'CANNOT_MESSAGE':
      return 'blocked';
    case 'ACCOUNT_DEACTIVATED':
      return 'account_deactivated';
    case 'MEDIA_NOT_ATTACHABLE':
    case 'MEDIA_NOT_FOUND':
      return 'media_unavailable';
    case 'FORBIDDEN': {
      // A group refuses only for "Only admins can send"; a 1:1 chat only for a deactivated person.
      const chat = await chatModels(app).Chat.findById(doc.chatId).select({ type: 1 }).lean();
      return chat?.type === 'group' ? 'admins_only' : 'account_deactivated';
    }
    default:
      return 'other';
  }
}

/** Mentions of people who have since left would refuse the whole message: those are dropped. */
async function currentMentions(app: FastifyInstance, doc: ScheduledDoc) {
  if (!doc.mentions?.length) return undefined;
  const ids = [...new Set(doc.mentions.map((mention) => mention.userId))].map(oid);
  const present = await chatModels(app)
    .ChatMember.find({ chatId: doc.chatId, userId: { $in: ids }, leftAt: null })
    .select({ userId: 1 })
    .lean();
  const still = new Set(present.map((member) => member.userId.toString()));
  return doc.mentions.filter((mention) => still.has(mention.userId));
}

async function finish(app: FastifyInstance, doc: ScheduledDoc, set: Partial<ScheduledDoc>) {
  const updated = await scheduledModels(app)
    .Scheduled.findOneAndUpdate(
      { _id: doc._id, status: 'sending' },
      { $set: { ...set, updatedAt: new Date() } },
      { returnDocument: 'after' },
    )
    .lean();
  const failed = set.failure ? { id: doc._id.toString(), reason: set.failure } : null;
  announceScheduled(app, doc.userId.toString(), doc.chatId.toString(), failed);
  return updated ?? { ...doc, ...set };
}

/** Sends one I have claimed (status `sending`), as its owner, and records how it went. */
export async function deliverClaimed(app: FastifyInstance, doc: ScheduledDoc) {
  const userId = doc.userId.toString();
  if (doc.attempts > MAX_ATTEMPTS) return finish(app, doc, { status: 'failed', failure: 'other' });
  if (await usersModel(app).exists({ _id: doc.userId, status: 'deactivated' })) {
    return finish(app, doc, { status: 'failed', failure: 'account_deactivated' });
  }
  try {
    const { message } = await sendMessage(app, {
      userId,
      chatId: doc.chatId.toString(),
      clientMsgId: doc.clientMsgId,
      text: doc.text ?? undefined,
      mediaId: doc.mediaId?.toString(),
      mentions: await currentMentions(app, doc),
      mentionsEveryone: doc.mentionsEveryone,
    });
    return finish(app, doc, {
      status: 'sent',
      failure: null,
      messageId: oid(message.id),
      doneAt: new Date(),
    });
  } catch (error) {
    // Anything else (MongoDB away, a restart) stays `sending` and is tried again later.
    if (!(error instanceof AppError)) throw error;
    return finish(app, doc, { status: 'failed', failure: await failureOf(app, doc, error) });
  }
}

const claim = { $inc: { attempts: 1 } };

/** Takes one due item, atomically: only one process (or job) ever sends it at a time. */
export async function claimDue(app: FastifyInstance, id: string, now = new Date()) {
  const { Scheduled } = scheduledModels(app);
  const stuck = new Date(now.getTime() - STUCK_MS);
  return Scheduled.findOneAndUpdate(
    {
      _id: oid(id),
      sendAt: { $lte: now },
      $or: [{ status: 'pending' }, { status: 'sending', claimedAt: { $lte: stuck } }],
    },
    { $set: { status: 'sending', claimedAt: now, updatedAt: now }, ...claim },
    { returnDocument: 'after' },
  ).lean();
}

async function runOne(app: FastifyInstance, id: string, now = new Date()) {
  const doc = await claimDue(app, id, now);
  if (doc) await deliverClaimed(app, doc);
}

/**
 * Sends everything due: pending ones whose time has come, and sends stuck for over 2 minutes.
 * Returns how many it handled. Runs at startup and every 15 s; also what tests call directly.
 */
export async function sweepScheduled(app: FastifyInstance, now = new Date()): Promise<number> {
  const { Scheduled } = scheduledModels(app);
  const stuck = new Date(now.getTime() - STUCK_MS);
  const [due, stalled] = await Promise.all([
    Scheduled.find({ status: 'pending', sendAt: { $lte: now } })
      .sort({ sendAt: 1 })
      .limit(SWEEP_BATCH)
      .select({ _id: 1 })
      .lean(),
    Scheduled.find({ status: 'sending', sendAt: { $lte: now }, claimedAt: { $lte: stuck } })
      .limit(SWEEP_BATCH)
      .select({ _id: 1 })
      .lean(),
  ]);
  let handled = 0;
  for (const { _id } of [...due, ...stalled]) {
    try {
      await runOne(app, _id.toString(), now);
      handled += 1;
    } catch (error) {
      app.log.warn({ err: error, scheduledId: _id.toString() }, 'scheduled message not sent yet');
    }
  }
  return handled;
}

/** "Send now": waiting or failed, mine, right away. */
export async function sendScheduledNow(
  app: FastifyInstance,
  userId: string,
  id: string,
  jobs: ScheduledJobs = noJobs,
): Promise<ScheduledMessage> {
  const doc = await ownScheduled(app, userId, id);
  const now = new Date();
  const claimed = await scheduledModels(app)
    .Scheduled.findOneAndUpdate(
      { _id: doc._id, status: { $in: ['pending', 'failed'] } },
      // Asked for by hand: a fresh start, however many tries came before.
      {
        $set: {
          status: 'sending',
          failure: null,
          sendAt: now,
          claimedAt: now,
          attempts: 1,
          updatedAt: now,
        },
      },
      { returnDocument: 'after' },
    )
    .lean();
  if (!claimed) throw new AppError('CONFLICT', 'This message is being sent or was sent.');
  if (doc.status === 'pending') await jobs.unschedule(id, doc.sendAt);
  return toScheduled(await deliverClaimed(app, claimed));
}

const jobIdOf = (id: string, sendAt: Date) => `sched-${id}-${sendAt.getTime()}`;

/** One delayed BullMQ job per scheduled message, processed in this (the API) process. */
export function startScheduledQueue(
  connection: Redis,
  run: (id: string) => Promise<void>,
  logger: Logger,
  prefix?: string,
) {
  const scope = prefix ? { prefix } : {};
  const queue = new Queue(QUEUE, { connection, ...scope });
  const worker = new Worker<{ id: string }>(QUEUE, async (job) => run(job.data.id), {
    connection,
    concurrency: 4,
    ...scope,
  });
  worker.on('error', (error) => logger.error({ err: error }, 'scheduled messages queue error'));
  queue.on('error', (error) => logger.error({ err: error }, 'scheduled messages queue error'));
  const jobs: ScheduledJobs = {
    async schedule(id, sendAt) {
      const delay = Math.max(0, sendAt.getTime() - Date.now());
      await queue.add(
        'send',
        { id },
        { jobId: jobIdOf(id, sendAt), delay, removeOnComplete: true, removeOnFail: 100 },
      );
    },
    async unschedule(id, sendAt) {
      await queue.remove(jobIdOf(id, sendAt));
    },
  };
  return {
    jobs,
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}

/** A failed timer is not a failed request: the sweep still sends it, at most 15 s late. */
function forgiving(jobs: ScheduledJobs, logger: Logger): ScheduledJobs {
  const safely = (work: () => Promise<void>) =>
    work().catch((error: unknown) => logger.warn({ err: error }, 'scheduled message timer'));
  return {
    schedule: (id, sendAt) => safely(() => jobs.schedule(id, sendAt)),
    unschedule: (id, sendAt) => safely(() => jobs.unschedule(id, sendAt)),
  };
}

export interface ScheduledRunner {
  jobs: ScheduledJobs;
  close(): Promise<void>;
}

/**
 * Runs in the API process, which alone has Socket.IO. With Redis: a delayed job per message. Always:
 * a sweep at startup and every 15 s, which survives restarts and lost jobs.
 */
export function startScheduledRunner(
  app: FastifyInstance,
  options: { sweepMs?: number; connection?: Redis | null } = {},
): ScheduledRunner {
  const url = app.env.REDIS_URL;
  const connection =
    options.connection !== undefined
      ? options.connection
      : app.redis && url
        ? createBullConnection(url, 'zuvo-api-scheduled')
        : null;
  const queue = connection
    ? startScheduledQueue(connection, (id) => runOne(app, id), app.log)
    : null;
  let running: Promise<unknown> = Promise.resolve();
  let busy = false;
  const sweep = () => {
    if (busy) return;
    busy = true;
    running = sweepScheduled(app)
      .catch((error: unknown) => app.log.error({ err: error }, 'scheduled messages sweep'))
      .finally(() => {
        busy = false;
      });
  };
  sweep();
  const timer = setInterval(sweep, options.sweepMs ?? SWEEP_MS);
  timer.unref();
  return {
    jobs: queue ? forgiving(queue.jobs, app.log) : noJobs,
    async close() {
      clearInterval(timer);
      await running;
      await queue?.close();
      if (connection && options.connection === undefined) await connection.quit();
    },
  };
}
