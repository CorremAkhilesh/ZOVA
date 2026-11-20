import {
  CALL_RING_SECONDS,
  callPushTagFor,
  isQuietAt,
  type PushPayload,
  passesQuietHours,
} from '@zuvo/protocol';
import type { FastifyInstance } from 'fastify';
import type { CallDoc } from '../db/call-models.ts';
import { deliverToDevices, liveDevices } from '../push/devices.ts';
import { displayNameOf, loadRecipient } from '../push/gather.ts';
import { MESSAGE_PUSH_TTL_SECONDS } from '../push/sender.ts';
import type { PushLanguage } from '../push/strings.ts';

const STRINGS: Record<
  PushLanguage,
  { incoming: string; calling: (name: string) => string; missed: string; open: string }
> = {
  en: {
    incoming: 'Incoming voice call',
    calling: (name) => `${name} is calling you`,
    missed: 'Missed voice call',
    open: 'Open the app to see who',
  },
  hi: {
    incoming: 'वॉइस कॉल आ रही है',
    calling: (name) => `${name} आपको कॉल कर रहे हैं`,
    missed: 'छूटी हुई वॉइस कॉल',
    open: 'देखने के लिए ऐप खोलें',
  },
};

/** Quiet hours (unless this chat is let through): the call shows, but does not ring. */
export async function quietFor(app: FastifyInstance, userId: string, chatId: string) {
  const recipient = await loadRecipient(app.mongo, userId);
  if (!recipient) return false;
  const { quietHours } = recipient;
  return (
    isQuietAt(quietHours, new Date()) &&
    !passesQuietHours(quietHours, { chatId, mentionsMe: false })
  );
}

/**
 * "Incoming call from X" (high priority, gone after the ringing time) or, with the same tag, "Missed
 * call". Only to the person called, on devices not looking at the app right now (those ring on
 * screen). With app lock on, the caller's name stays out of it.
 */
export async function pushCall(
  app: FastifyInstance,
  call: Pick<CallDoc, '_id' | 'chatId' | 'callerId' | 'calleeId'>,
  state: 'incoming' | 'missed',
  silent: boolean,
): Promise<number> {
  const ctx = app.push.context();
  const calleeId = call.calleeId.toString();
  const devices = await liveDevices(ctx, calleeId);
  if (devices.length === 0) return 0;
  const attended = await ctx.attendance.attended(devices.map((device) => device.sessionId));
  const targets = devices.filter((device) => !attended.has(device.sessionId));
  const recipient = await loadRecipient(ctx.mongo, calleeId);
  if (targets.length === 0 || !recipient || recipient.deactivated) return 0;
  const s = STRINGS[recipient.language];
  const name = recipient.appLock ? '' : await displayNameOf(ctx.mongo, call.callerId);
  const callId = call._id.toString();
  const payload: PushPayload = {
    kind: 'call',
    v: 1,
    callId,
    chatId: call.chatId.toString(),
    state,
    tag: callPushTagFor(callId),
    title: state === 'incoming' ? s.incoming : s.missed,
    body: name ? (state === 'incoming' ? s.calling(name) : name) : s.open,
    silent,
    sentAt: new Date().toISOString(),
  };
  const sent = await deliverToDevices(ctx, targets, payload, {
    urgency: 'high',
    ttlSeconds: state === 'incoming' ? CALL_RING_SECONDS : MESSAGE_PUSH_TTL_SECONDS,
    topic: callId,
  });
  return sent.delivered;
}
