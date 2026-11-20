import { isQuietAt, type PushPayload, passesQuietHours, pollPushTagFor } from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import type { MessageDoc } from '../db/chat-models.ts';
import { deliverToDevices, liveDevices } from '../push/devices.ts';
import { blockedBetween, displayNameOf, loadChat, loadRecipient } from '../push/gather.ts';
import type { PushLanguage } from '../push/strings.ts';
import { oid } from './chats.service.ts';

/** At most this many poll-vote notifications per person per minute. */
const PER_MINUTE = 10;

const STRINGS: Record<PushLanguage, { voted: (name: string) => string; someone: string }> = {
  en: { voted: (name) => `${name} voted in your poll`, someone: 'Someone voted in your poll' },
  hi: { voted: (name) => `${name} ने आपके पोल में वोट किया`, someone: 'किसी ने आपके पोल में वोट किया' },
};

/** Why a vote does not notify the poll's sender (logged, never with content). */
export type PollVoteSkip =
  | 'own'
  | 'not_member'
  | 'off'
  | 'muted'
  | 'quiet_hours'
  | 'blocked'
  | 'no_devices'
  | 'rate_limited';

/**
 * "Asha voted in your poll": quiet (no sound or buzz), one notification per poll that each new vote
 * replaces, only to devices not looking at the app. Never in a muted chat, during quiet hours (unless
 * the chat is let through), across a block, or with the setting off.
 */
export async function notifyPollVote(
  app: FastifyInstance,
  input: { message: MessageDoc; voterId: string },
): Promise<number | PollVoteSkip> {
  const { message, voterId } = input;
  const creatorId = message.senderId?.toString();
  if (!creatorId || creatorId === voterId || !message.poll) return 'own';
  const ctx = app.push.context();
  const chatId = message.chatId.toString();
  const loaded = await loadChat(ctx.mongo, chatId, creatorId);
  if (!loaded || loaded.member.leftAt) return 'not_member';
  const recipient = await loadRecipient(ctx.mongo, creatorId);
  if (!recipient || recipient.deactivated) return 'not_member';
  if (!recipient.settings.pollVotes) return 'off';
  const now = new Date();
  if (loaded.member.mutedUntil && loaded.member.mutedUntil > now) return 'muted';
  const quiet = recipient.quietHours;
  if (isQuietAt(quiet, now) && !passesQuietHours(quiet, { chatId, mentionsMe: false })) {
    return 'quiet_hours';
  }
  if (await blockedBetween(ctx.mongo, creatorId, voterId)) return 'blocked';
  const devices = await liveDevices(ctx, creatorId);
  const attended = await ctx.attendance.attended(devices.map((device) => device.sessionId));
  const targets = devices.filter((device) => !attended.has(device.sessionId));
  if (targets.length === 0) return 'no_devices';
  if ((await ctx.counter.increment(`zuvo:push:poll:${creatorId}`, 60)) > PER_MINUTE) {
    return 'rate_limited';
  }
  const s = STRINGS[recipient.language];
  // A locked chat, app lock or previews off: no name and no question.
  const hidden =
    recipient.appLock || loaded.member.locked === true || !recipient.settings.showPreview;
  const name = hidden ? '' : await displayNameOf(ctx.mongo, oid(voterId));
  const messageId = message._id.toString();
  const payload: PushPayload = {
    kind: 'poll',
    v: 1,
    chatId,
    messageId,
    tag: pollPushTagFor(messageId),
    title: name ? s.voted(name) : s.someone,
    body: hidden ? '' : `📊 ${message.poll.question}`.slice(0, 400),
    silent: true,
    sentAt: now.toISOString(),
  };
  const sent = await deliverToDevices(ctx, targets, payload, {
    urgency: 'normal',
    topic: messageId,
  });
  return sent.delivered;
}
