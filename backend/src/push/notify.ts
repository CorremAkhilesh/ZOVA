import { PUSH_USER_PER_MINUTE } from '@zuvo/protocol';
import type { Connection } from 'mongoose';
import type { Logger } from 'pino';
import type { CounterStore } from '../auth/counter-store.ts';
import { canSeeSeq } from '../chats/visibility.ts';
import { registerChatModels } from '../db/chat-models.ts';
import type { AttendanceStore } from './attendance-store.ts';
import { buildMessagePayload } from './content.ts';
import { decidePush, type PushDecisionInput, type SkipReason } from './decide.ts';
import { deliverToDevices, liveDevices } from './devices.ts';
import {
  blockedBetween,
  displayNameOf,
  hiddenFor,
  loadCandidates,
  loadChat,
  loadRecipient,
  unreadChatCount,
} from './gather.ts';
import type { PushSender } from './sender.ts';

/** What the API process or the worker gives the push job. */
export interface PushContext {
  mongo: Connection;
  log: Pick<Logger, 'info' | 'warn' | 'error'>;
  sender: PushSender;
  attendance: Pick<AttendanceStore, 'attended'>;
  /** Per-person push rate (Redis when available). */
  counter: Pick<CounterStore, 'increment'>;
}

/** One person, one chat: "notify them about what is new here". */
export interface PushJob {
  userId: string;
  chatId: string;
}

export type JobSkipReason =
  | SkipReason
  | 'not_member'
  | 'deactivated'
  | 'already_notified'
  | 'no_devices'
  | 'rate_limited';

export type PushOutcome =
  | { status: 'sent'; devices: number; count: number }
  | { status: 'skipped'; reason: JobSkipReason };

/** Thrown when every device failed for a reason worth retrying (network, 5xx). */
export class PushRetryError extends Error {
  constructor() {
    super('every push attempt failed');
    this.name = 'PushRetryError';
  }
}

const skipped = (ctx: PushContext, job: PushJob, reason: JobSkipReason): PushOutcome => {
  ctx.log.info({ ...job, reason }, 'push skipped');
  return { status: 'skipped', reason };
};

type Chat = NonNullable<Awaited<ReturnType<typeof loadChat>>>;
type Recipient = NonNullable<Awaited<ReturnType<typeof loadRecipient>>>;

/** The decision input for one message, before the device is known. */
async function decisionInputs(
  ctx: PushContext,
  job: PushJob,
  { chat, member }: Chat,
  recipient: Recipient,
  floor: number,
) {
  const messages = await loadCandidates(ctx.mongo, job.chatId, floor, chat.seq);
  const hidden = await hiddenFor(
    ctx.mongo,
    job.userId,
    job.chatId,
    messages.map((m) => m._id),
  );
  const peerId =
    chat.type === 'direct' ? chat.pairKey?.split(':').find((id) => id !== job.userId) : undefined;
  const blocked = peerId ? await blockedBetween(ctx.mongo, job.userId, peerId) : false;
  const now = new Date();
  return messages.map((message) => {
    const input: PushDecisionInput = {
      now,
      isSender: message.senderId?.toString() === job.userId,
      message: {
        chatId: job.chatId,
        seq: message.seq,
        system: message.type === 'system',
        deletedForEveryone: message.deletedForEveryoneAt !== null,
        expiresAt: message.expiresAt ?? null,
        visible: canSeeSeq(member, message.seq),
        hiddenForMe: hidden.has(message._id.toString()),
        mentionsMe:
          message.mentionsEveryone === true ||
          (message.mentions ?? []).some((mention) => mention.userId.toString() === job.userId),
      },
      recipient: {
        lastReadSeq: member.lastReadSeq,
        blocked,
        mutedUntil: member.mutedUntil ?? null,
        quietHours: recipient.quietHours,
      },
      device: { attended: false },
    };
    return { message, input };
  });
}

type Candidate = Awaited<ReturnType<typeof decisionInputs>>[number];
type Prepared = { loaded: Chat; recipient: Recipient; eligible: Candidate[]; newest: Candidate };

/** What is new for this person here, and which of it they should hear about. */
async function prepare(ctx: PushContext, job: PushJob): Promise<Prepared | JobSkipReason> {
  const loaded = await loadChat(ctx.mongo, job.chatId, job.userId);
  if (!loaded || loaded.member.leftAt) return 'not_member';
  const recipient = await loadRecipient(ctx.mongo, job.userId);
  if (!recipient || recipient.deactivated) return 'deactivated';
  const { chat, member } = loaded;
  const floor = Math.max(member.lastReadSeq, member.pushedSeq ?? 0);
  if (chat.seq <= floor) return member.lastReadSeq >= chat.seq ? 'read' : 'already_notified';
  const candidates = await decisionInputs(ctx, job, loaded, recipient, floor);
  const eligible = candidates.filter(({ input }) => decidePush(input).send);
  const newest = eligible[0];
  if (newest) return { loaded, recipient, eligible, newest };
  const first = candidates[0] ? decidePush(candidates[0].input) : null;
  return first && !first.send ? first.reason : 'read';
}

async function composePayload(ctx: PushContext, job: PushJob, prepared: Prepared) {
  const { loaded, recipient, eligible, newest } = prepared;
  const { message } = newest;
  return buildMessagePayload({
    chatId: job.chatId,
    chatType: loaded.chat.type,
    groupName: loaded.chat.group?.name ?? null,
    senderName: await displayNameOf(ctx.mongo, message.senderId),
    newest: {
      text: message.text,
      media: message.media ?? null,
      poll: message.poll ? { question: message.poll.question } : null,
      viewOnce: message.viewOnce === true,
    },
    seq: message.seq,
    count: eligible.length,
    badge: await unreadChatCount(ctx.mongo, job.userId),
    settings: recipient.settings,
    chatLocked: loaded.member.locked === true,
    appLock: recipient.appLock,
    language: recipient.language,
    now: new Date(),
  });
}

/**
 * Notifies one person about a chat's new messages, at most once per message. Re-checks everything
 * at send time: reads that happened meanwhile, sessions that ended, devices now being looked at.
 */
export async function runPushJob(ctx: PushContext, job: PushJob): Promise<PushOutcome> {
  const prepared = await prepare(ctx, job);
  if (typeof prepared === 'string') return skipped(ctx, job, prepared);
  const { chat, member } = prepared.loaded;

  const devices = await liveDevices(ctx, job.userId);
  if (devices.length === 0) return skipped(ctx, job, 'no_devices');
  const attended = await ctx.attendance.attended(devices.map((device) => device.sessionId));
  const targets = devices.filter((device) => {
    const state = { attended: attended.has(device.sessionId) };
    return decidePush({ ...prepared.newest.input, device: state }).send;
  });
  const { ChatMember } = registerChatModels(ctx.mongo);
  // Atomic: of two jobs racing, only one notifies these messages.
  const claim = () =>
    ChatMember.updateOne(
      {
        _id: member._id,
        $or: [{ pushedSeq: { $exists: false } }, { pushedSeq: { $lt: chat.seq } }],
      },
      { $set: { pushedSeq: chat.seq } },
    );
  if (targets.length === 0) {
    // Seen on the screen in front of them: not worth a "(+N more)" later.
    await claim();
    return skipped(ctx, job, 'attended');
  }
  const rate = await ctx.counter.increment(`zuvo:push:rate:${job.userId}`, 60);
  if (rate > PUSH_USER_PER_MINUTE) return skipped(ctx, job, 'rate_limited');
  if ((await claim()).modifiedCount === 0) return skipped(ctx, job, 'already_notified');

  const payload = await composePayload(ctx, job, prepared);
  const sent = await deliverToDevices(ctx, targets, payload, {
    urgency: 'high',
    topic: job.chatId,
  });
  if (sent.delivered === 0 && sent.retryable > 0) {
    // Let the queue try again later: give the messages back.
    await ChatMember.updateOne(
      { _id: member._id, pushedSeq: chat.seq },
      { $set: { pushedSeq: member.pushedSeq ?? 0 } },
    );
    throw new PushRetryError();
  }
  const count = prepared.eligible.length;
  const hidden = payload.kind === 'message' && payload.hidden;
  ctx.log.info({ ...job, devices: sent.delivered, count, hidden }, 'push sent');
  return { status: 'sent', devices: sent.delivered, count };
}
