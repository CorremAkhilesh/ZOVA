import { apiErrorSchema, markChatReadResponseSchema, sendMessageAckSchema } from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { headers } from '../../../test/auth-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import {
  closeAllSockets,
  connect,
  listen,
  record,
  signedIn,
  uuidv7,
  waitUntil,
} from '../../../test/realtime-helpers.ts';
import { getOrCreateDirectChat } from '../../chats/chats.service.ts';
import { sendMessage } from '../../chats/messages.service.ts';
import { blockUser } from '../../moderation/blocks.service.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
let url: string;
const app = () => built.app;
let seed = 0;

async function pair() {
  seed += 1;
  const alice = await signedIn(app(), `actions${seed}a@corremadvisory.com`);
  const bob = await signedIn(app(), `actions${seed}b@corremadvisory.com`);
  const chat = await getOrCreateDirectChat(app(), alice.id, bob.id);
  return { alice, bob, chatId: chat.id };
}

const post = (cookie: string | undefined, path: string, payload: object) =>
  app().inject({ method: 'POST', url: path, headers: headers(cookie), payload });

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
  url = await listen(app());
});
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

describe('POST /v1/chats/:id/reply (notification "Reply")', () => {
  it('sends a text message like the socket does, and a retry returns the same message', async () => {
    const { alice, bob, chatId } = await pair();
    const aliceSocket = await connect(url, alice.cookie);
    const arrived = record(aliceSocket, 'message:new');
    const clientMsgId = uuidv7();
    const first = await post(bob.cookie, `/v1/chats/${chatId}/reply`, {
      clientMsgId,
      text: 'On my way',
    });
    expect(first.statusCode).toBe(200);
    const ack = sendMessageAckSchema.parse(first.json());
    expect(ack.duplicate).toBe(false);
    await waitUntil(() =>
      expect(arrived.map((event) => event.message.text)).toEqual(['On my way']),
    );
    const again = await post(bob.cookie, `/v1/chats/${chatId}/reply`, {
      clientMsgId,
      text: 'On my way',
    });
    expect(sendMessageAckSchema.parse(again.json())).toEqual({ ...ack, duplicate: true });
  });

  it('refuses empty text and a bad id, and needs a session', async () => {
    const { bob, chatId } = await pair();
    expect(
      (await post(bob.cookie, `/v1/chats/${chatId}/reply`, { clientMsgId: uuidv7(), text: '  ' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await post(bob.cookie, `/v1/chats/${chatId}/reply`, { clientMsgId: 'x', text: 'hi' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await post(undefined, `/v1/chats/${chatId}/reply`, { clientMsgId: uuidv7(), text: 'hi' }))
        .statusCode,
    ).toBe(401);
  });

  it('cannot write into someone else’s chat, or past a block', async () => {
    const { alice, bob, chatId } = await pair();
    const stranger = await signedIn(app(), `actions-stranger${seed}@corremadvisory.com`);
    const outside = await post(stranger.cookie, `/v1/chats/${chatId}/reply`, {
      clientMsgId: uuidv7(),
      text: 'hi',
    });
    expect(outside.statusCode).toBe(404);
    await blockUser(app(), alice.id, bob.id);
    const blocked = await post(bob.cookie, `/v1/chats/${chatId}/reply`, {
      clientMsgId: uuidv7(),
      text: 'hi',
    });
    expect(blocked.statusCode).toBe(403);
    expect(apiErrorSchema.parse(blocked.json()).code).toBe('CANNOT_MESSAGE');
  });
});

describe('POST /v1/chats/:id/read (notification "Mark as read")', () => {
  it('reads up to the position, tells my devices, and gives the new badge', async () => {
    const { alice, bob, chatId } = await pair();
    const other = await pair();
    // Bob also has an unread chat with someone else: the badge stays at 1.
    const second = await getOrCreateDirectChat(app(), other.alice.id, bob.id);
    await sendMessage(app(), {
      userId: other.alice.id,
      chatId: second.id,
      clientMsgId: uuidv7(),
      text: 'y',
    });
    const sent = await sendMessage(app(), {
      userId: alice.id,
      chatId,
      clientMsgId: uuidv7(),
      text: 'z',
    });
    const bobSocket = await connect(url, bob.cookie);
    const reads = record(bobSocket, 'read:update');
    const response = await post(bob.cookie, `/v1/chats/${chatId}/read`, { seq: sent.message.seq });
    expect(markChatReadResponseSchema.parse(response.json())).toEqual({
      chatId,
      lastReadSeq: sent.message.seq,
      unreadCount: 0,
      badge: 1,
    });
    await waitUntil(() => expect(reads.length).toBeGreaterThan(0));
  });

  it('is for members only, and needs a session', async () => {
    const { chatId } = await pair();
    const stranger = await signedIn(app(), `actions-reader${seed}@corremadvisory.com`);
    expect((await post(stranger.cookie, `/v1/chats/${chatId}/read`, { seq: 1 })).statusCode).toBe(
      404,
    );
    expect((await post(undefined, `/v1/chats/${chatId}/read`, { seq: 1 })).statusCode).toBe(401);
  });
});
