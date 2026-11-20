import {
  callAcceptAckSchema,
  callIncomingEventSchema,
  callLogResponseSchema,
  callStartAckSchema,
  callUpdateEventSchema,
  messageSchema,
} from '@zuvo/protocol';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { callClient } from '../../../test/call-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { closeAllSockets, listen, record, waitUntil } from '../../../test/realtime-helpers.ts';
import { callModels } from '../../calls/call-finish.ts';

// 1:1 voice calls over the socket: ringing, answering, signaling only between the two devices in the
// call, declining, missing, busy, and the line each call leaves in the chat and the call history.

let built: Awaited<ReturnType<typeof buildTestApp>>;
let url = '';
const app = () => built.app;
const { person, otherDevice, device, request, direct, emit, next, connectedCall } = callClient(
  app,
  () => url,
);

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000', CALLS_ENABLED_FOR: 'all' });
  url = await listen(app());
});
afterEach(() => closeAllSockets());
afterAll(async () => {
  await built.cleanup();
});

async function pair() {
  const asha = await person('asha');
  const bharat = await person('bharat');
  const chatId = await direct(asha, bharat);
  return { asha, bharat, chatId };
}

async function history(who: Awaited<ReturnType<typeof person>>, chatId: string) {
  const response = await request(who, 'GET', `/v1/chats/${chatId}/messages`);
  return messageSchema.array().parse(response.json().items);
}

const callLines = (
  messages: Array<{ system?: { kind: string; value: string | null } | null | undefined }>,
) =>
  messages.flatMap((message) =>
    message.system?.kind === 'call' ? [message.system.value ?? ''] : [],
  );

describe('a call that is answered', () => {
  it('rings, connects, passes signals between the two devices only, and ends for both', async () => {
    const { asha, bharat, chatId } = await pair();
    const [ashaPhone, bharatPhone] = [await device(asha), await device(bharat)];

    const incoming = next(bharatPhone, 'call:incoming');
    const started = await emit(ashaPhone, 'call:start', { chatId, kind: 'voice' });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const { call, busy } = callStartAckSchema.parse(started.data);
    expect(busy).toBe(false);
    expect(call).toMatchObject({ status: 'ringing', callerId: asha.id, calleeId: bharat.id });
    const rang = callIncomingEventSchema.parse(await incoming);
    expect(rang).toMatchObject({ call: { id: call.id, chatId }, silent: false });

    // Bharat's phone shows it: Asha hears "Ringing…".
    const ringing = next(ashaPhone, 'call:update', ({ call: c }) => c.ringingAt !== null);
    expect((await emit(bharatPhone, 'call:ringing', { callId: call.id })).ok).toBe(true);
    await ringing;

    const answeredForAsha = next(ashaPhone, 'call:update', ({ call: c }) => c.status === 'active');
    const accepted = await emit(bharatPhone, 'call:accept', { callId: call.id });
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(callAcceptAckSchema.parse(accepted.data).call.status).toBe('active');
    await answeredForAsha;

    // The offer reaches Bharat's phone, the answer comes back to Asha's.
    const offer = next(bharatPhone, 'call:signal');
    await emit(ashaPhone, 'call:signal', {
      callId: call.id,
      signal: { type: 'offer', sdp: 'v=0 offer' },
    });
    expect(await offer).toEqual({ callId: call.id, signal: { type: 'offer', sdp: 'v=0 offer' } });
    const answer = next(ashaPhone, 'call:signal');
    await emit(bharatPhone, 'call:signal', {
      callId: call.id,
      signal: { type: 'answer', sdp: 'v=0 answer' },
    });
    expect((await answer).signal).toEqual({ type: 'answer', sdp: 'v=0 answer' });

    // Someone else cannot inject anything into the call.
    const outsider = await device(await person('outsider'));
    const injected = await emit(outsider, 'call:signal', {
      callId: call.id,
      signal: { type: 'offer', sdp: 'evil' },
    });
    expect(injected.ok ? null : injected.error.code).toBe('NOT_FOUND');

    const endedForBharat = next(bharatPhone, 'call:update', ({ call: c }) => c.status === 'ended');
    expect((await emit(ashaPhone, 'call:end', { callId: call.id })).ok).toBe(true);
    const ended = callUpdateEventSchema.parse(await endedForBharat);
    expect(ended.call).toMatchObject({ status: 'ended', outcome: 'answered' });

    // "Voice call · 0:00" in the chat for both, read by both; the history has it for both.
    await waitUntil(async () => {
      expect(callLines(await history(bharat, chatId))).toEqual([
        expect.stringMatching(/^voice:answered/),
      ]);
    });
    const chat = await request(bharat, 'GET', `/v1/chats/${chatId}`);
    expect(chat.json().chat.unreadCount).toBe(0);
    for (const [who, direction] of [
      [asha, 'outgoing'],
      [bharat, 'incoming'],
    ] as const) {
      const log = callLogResponseSchema.parse((await request(who, 'GET', '/v1/calls')).json());
      expect(log.items[0]).toMatchObject({ id: call.id, direction, outcome: 'answered', chatId });
    }
  });

  it('rings every device; answering on one stops the others, and only that one gets signals', async () => {
    const { asha, bharat, chatId } = await pair();
    const ashaPhone = await device(asha);
    const bharatPhone = await device(bharat);
    const bharatLaptop = await device(await otherDevice(bharat));
    const laptopSignals = record(bharatLaptop, 'call:signal');

    const onLaptop = next(bharatLaptop, 'call:incoming');
    const laptopStops = next(bharatLaptop, 'call:update', ({ call }) => call.status === 'active');
    const callId = await connectedCall(ashaPhone, bharatPhone, chatId);
    await onLaptop;
    await laptopStops;

    // The laptop cannot answer too, nor speak in the call.
    const late = await emit(bharatLaptop, 'call:accept', { callId });
    expect(late.ok ? null : late.error.code).toBe('CONFLICT');
    const sneaky = await emit(bharatLaptop, 'call:signal', {
      callId,
      signal: { type: 'answer', sdp: 'x' },
    });
    expect(sneaky.ok ? null : sneaky.error.code).toBe('FORBIDDEN');

    const offer = next(bharatPhone, 'call:signal');
    await emit(ashaPhone, 'call:signal', { callId, signal: { type: 'offer', sdp: 'o' } });
    await offer;
    expect(laptopSignals).toEqual([]);
    await emit(bharatPhone, 'call:end', { callId });
  });
});

describe('a call that is not answered', () => {
  it('declined: over for both, "declined" in the history, and not unread for the callee', async () => {
    const { asha, bharat, chatId } = await pair();
    const [ashaPhone, bharatPhone] = [await device(asha), await device(bharat)];
    const incoming = next(bharatPhone, 'call:incoming');
    const started = await emit(ashaPhone, 'call:start', { chatId, kind: 'voice' });
    if (!started.ok) throw new Error(started.error.code);
    await incoming;
    const over = next(ashaPhone, 'call:update', ({ call }) => call.status === 'ended');
    await emit(bharatPhone, 'call:decline', { callId: started.data.call.id });
    expect((await over).call.outcome).toBe('declined');
    await waitUntil(async () =>
      expect(callLines(await history(asha, chatId))).toEqual(['voice:declined']),
    );
    expect((await request(bharat, 'GET', `/v1/chats/${chatId}`)).json().chat.unreadCount).toBe(0);
  });

  it('missed after the ringing time: a missed call, unread for the callee', async () => {
    const { asha, bharat, chatId } = await pair();
    const [ashaPhone, bharatPhone] = [await device(asha), await device(bharat)];
    const started = await emit(ashaPhone, 'call:start', { chatId, kind: 'voice' });
    if (!started.ok) throw new Error(started.error.code);
    const over = next(bharatPhone, 'call:update', ({ call }) => call.status === 'ended');
    await app().callTimers.fire(started.data.call.id);
    expect((await over).call.outcome).toBe('missed');
    await waitUntil(async () =>
      expect(callLines(await history(bharat, chatId))).toEqual(['voice:missed']),
    );
    expect((await request(bharat, 'GET', `/v1/chats/${chatId}`)).json().chat.unreadCount).toBe(1);
    expect((await request(asha, 'GET', `/v1/chats/${chatId}`)).json().chat.unreadCount).toBe(0);
  });

  it('cancelled by the caller: a missed call for the callee', async () => {
    const { asha, bharat, chatId } = await pair();
    const [ashaPhone, bharatPhone] = [await device(asha), await device(bharat)];
    const started = await emit(ashaPhone, 'call:start', { chatId, kind: 'voice' });
    if (!started.ok) throw new Error(started.error.code);
    const over = next(bharatPhone, 'call:update', ({ call }) => call.status === 'ended');
    await emit(ashaPhone, 'call:end', { callId: started.data.call.id });
    expect((await over).call.outcome).toBe('cancelled');
  });

  it('busy: the other person is on a call; the caller hears so and they get a missed call', async () => {
    const { asha, bharat, chatId } = await pair();
    const chitra = await person('chitra');
    const chitraChat = await direct(chitra, bharat);
    const [ashaPhone, bharatPhone, chitraPhone] = [
      await device(asha),
      await device(bharat),
      await device(chitra),
    ];
    const first = await connectedCall(ashaPhone, bharatPhone, chatId);
    const bharatIncoming = record(bharatPhone, 'call:incoming');
    const second = await emit(chitraPhone, 'call:start', { chatId: chitraChat, kind: 'voice' });
    expect(second.ok && second.data).toMatchObject({ busy: true, call: { outcome: 'busy' } });
    expect(bharatIncoming).toEqual([]);
    const log = callLogResponseSchema.parse((await request(bharat, 'GET', '/v1/calls')).json());
    expect(log.items[0]).toMatchObject({ direction: 'incoming', outcome: 'busy' });
    // And Asha, on a call herself, cannot start another.
    const again = await emit(ashaPhone, 'call:start', { chatId, kind: 'voice' });
    expect(again.ok ? null : again.error.code).toBe('CALL_IN_PROGRESS');
    await emit(ashaPhone, 'call:end', { callId: first });
  });

  it('a call left ringing by a server that went away counts as missed, and frees both people', async () => {
    const { asha, chatId } = await pair();
    const ashaPhone = await device(asha);
    const started = await emit(ashaPhone, 'call:start', { chatId, kind: 'voice' });
    if (!started.ok) throw new Error(started.error.code);
    const callId = started.data.call.id;
    app().callTimers.clear(callId);
    await callModels(app()).Call.updateOne(
      { _id: callId },
      { $set: { startedAt: new Date(Date.now() - 5 * 60_000) } },
    );
    const again = await emit(ashaPhone, 'call:start', { chatId, kind: 'voice' });
    expect(again.ok && again.data.busy).toBe(false);
    const old = await callModels(app()).Call.findById(callId).lean();
    expect(old).toMatchObject({ status: 'ended', outcome: 'missed' });
    if (again.ok) await emit(ashaPhone, 'call:end', { callId: again.data.call.id });
  });
});
