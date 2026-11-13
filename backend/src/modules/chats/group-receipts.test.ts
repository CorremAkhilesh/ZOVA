import { messageInfoResponseSchema } from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectIndexedQuery } from '../../../test/expect-indexed-query.ts';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import {
  closeAllSockets,
  connect,
  listen,
  record,
  uuidv7,
  waitUntil,
} from '../../../test/realtime-helpers.ts';
import { insertUser } from '../../../test/user-helpers.ts';
import { chatModels, oid } from '../../chats/chats.service.ts';
import { onUserDeactivated } from '../../chats/group-ownership.service.ts';
import { sendMessage } from '../../chats/messages.service.ts';
import { markDelivered, markRead } from '../../chats/receipts.service.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call, group, say, summary, setReceipts } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
});
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

const marks = async (who: Person, chatId: string) => {
  const chat = await summary(who, chatId);
  return { delivered: chat.peerDeliveredSeq, read: chat.peerReadSeq };
};

async function threeWay() {
  const [asha, bharat, chitra] = [await person(), await person(), await person()];
  const chatId = await group(asha, [bharat, chitra]);
  const { message } = await say(asha, chatId, 'hello');
  return { asha, bharat, chitra, chatId, message };
}

const info = async (who: Person, chatId: string, id: string) => {
  const response = await call(who, 'GET', `/v1/chats/${chatId}/messages/${id}/info`);
  expect(response.statusCode).toBe(200);
  return messageInfoResponseSchema.parse(response.json());
};

describe('group ticks', () => {
  it('two ticks only when everyone’s devices have it', async () => {
    const { asha, bharat, chitra, chatId, message } = await threeWay();
    await markDelivered(app(), bharat.id, chatId, message.seq);
    expect((await marks(asha, chatId)).delivered).toBeLessThan(message.seq);
    await markDelivered(app(), chitra.id, chatId, message.seq);
    expect((await marks(asha, chatId)).delivered).toBe(message.seq);
  });

  it('color only when everyone has read it', async () => {
    const { asha, bharat, chitra, chatId, message } = await threeWay();
    await markRead(app(), bharat.id, chatId, message.seq);
    expect((await marks(asha, chatId)).read).toBeLessThan(message.seq);
    await markRead(app(), chitra.id, chatId, message.seq);
    expect(await marks(asha, chatId)).toEqual({ delivered: message.seq, read: message.seq });
  });

  it('someone with read receipts off counts once their device has it', async () => {
    const { asha, bharat, chitra, chatId, message } = await threeWay();
    await setReceipts(chitra, false);
    await markRead(app(), bharat.id, chatId, message.seq);
    expect((await marks(asha, chatId)).read).toBeLessThan(message.seq);
    await markDelivered(app(), chitra.id, chatId, message.seq);
    expect((await marks(asha, chatId)).read).toBe(message.seq);
  });

  it('with my own receipts off, I see no reads', async () => {
    const { asha, bharat, chitra, chatId, message } = await threeWay();
    await setReceipts(asha, false);
    await markRead(app(), bharat.id, chatId, message.seq);
    await markRead(app(), chitra.id, chatId, message.seq);
    expect(await marks(asha, chatId)).toEqual({ delivered: message.seq, read: 0 });
  });

  it('never goes back, and someone leaving can complete it', async () => {
    const { asha, bharat, chitra, chatId, message } = await threeWay();
    await markRead(app(), bharat.id, chatId, message.seq);
    await call(chitra, 'POST', `/v1/chats/${chatId}/leave`);
    expect((await marks(asha, chatId)).read).toBe(message.seq);
    const dinesh = await person();
    await call(asha, 'POST', `/v1/chats/${chatId}/members`, { userIds: [dinesh.id] });
    expect((await marks(asha, chatId)).read).toBe(message.seq);
  });

  it('a deactivated account stops holding them up', async () => {
    const { asha, bharat, chitra, chatId, message } = await threeWay();
    await markRead(app(), bharat.id, chatId, message.seq);
    await onUserDeactivated(app(), chitra.id);
    expect((await marks(asha, chatId)).read).toBe(message.seq);
  });

  it('are told live, once, not for each person', async () => {
    const { asha, bharat, chitra, chatId, message } = await threeWay();
    const socket = await connect(await serverUrl(), asha.cookie);
    const heard = record(socket, 'receipt:update');
    await markDelivered(app(), bharat.id, chatId, message.seq);
    await markDelivered(app(), chitra.id, chatId, message.seq);
    await waitUntil(() => expect(heard).toHaveLength(1));
    expect(heard[0]).toMatchObject({ chatId, lastDeliveredSeq: message.seq });
  });
});

describe('message info', () => {
  it('lists who has read and who has received, with times', async () => {
    const { asha, bharat, chitra, chatId, message } = await threeWay();
    await markRead(app(), bharat.id, chatId, message.seq);
    await markDelivered(app(), chitra.id, chatId, message.seq);
    const result = await info(asha, chatId, message.id);
    expect(result.readBy.map((entry) => entry.user.id)).toEqual([bharat.id]);
    expect(result.deliveredTo.map((entry) => entry.user.id)).toEqual([chitra.id]);
    expect(result.readBy[0]?.at).not.toBeNull();
    expect(result.deliveredTo[0]?.at).not.toBeNull();
    expect(result.waiting).toBe(0);
  });

  it('counts those still waiting', async () => {
    const { asha, chatId, message } = await threeWay();
    expect((await info(asha, chatId, message.id)).waiting).toBe(2);
  });

  it('only the sender can ask', async () => {
    const { bharat, chatId, message } = await threeWay();
    const url = `/v1/chats/${chatId}/messages/${message.id}/info`;
    expect((await call(bharat, 'GET', url)).statusCode).toBe(403);
    expect((await call(await person(), 'GET', url)).statusCode).toBe(404);
    expect((await call(null, 'GET', url)).statusCode).toBe(401);
  });

  it('shows someone with read receipts off as delivered, even once they have read', async () => {
    const { asha, chitra, chatId, message } = await threeWay();
    await setReceipts(chitra, false);
    await markRead(app(), chitra.id, chatId, message.seq);
    const result = await info(asha, chatId, message.id);
    expect(result.readBy).toEqual([]);
    expect(result.deliveredTo.map((entry) => entry.user.id)).toEqual([chitra.id]);
  });

  it('shows nobody as having read while my own receipts are off', async () => {
    const { asha, bharat, chatId, message } = await threeWay();
    await markRead(app(), bharat.id, chatId, message.seq);
    await setReceipts(asha, false);
    const result = await info(asha, chatId, message.id);
    expect(result.readBy).toEqual([]);
    expect(result.deliveredTo.map((entry) => entry.user.id)).toEqual([bharat.id]);
  });

  it('leaves out someone who joined after it, or has left', async () => {
    const { asha, bharat, chatId, message } = await threeWay();
    await call(bharat, 'POST', `/v1/chats/${chatId}/leave`);
    const dinesh = await person();
    await call(asha, 'POST', `/v1/chats/${chatId}/members`, { userIds: [dinesh.id] });
    await markRead(app(), dinesh.id, chatId, 99);
    expect((await info(asha, chatId, message.id)).waiting).toBe(1);
  });

  it('works in a direct chat, with the reciprocal rule', async () => {
    const [asha, bharat] = [await person(), await person()];
    const created = await call(asha, 'POST', '/v1/chats/direct', { userId: bharat.id });
    const chatId = created.json().chat.id;
    const { message } = await say(asha, chatId, 'hi');
    await markRead(app(), bharat.id, chatId, message.seq);
    expect((await info(asha, chatId, message.id)).readBy).toHaveLength(1);
    const second = await say(asha, chatId, 'again');
    await setReceipts(asha, false);
    await markRead(app(), bharat.id, chatId, second.message.seq);
    const after = await info(asha, chatId, second.message.id);
    expect(after.readBy).toEqual([]);
    expect(after.deliveredTo).toHaveLength(1);
  });
});

describe('a 256-member group', () => {
  it('delivers one message to all of them', async () => {
    const asha = await person();
    const others = await Promise.all(
      Array.from({ length: 255 }, (_unused, n) =>
        insertUser(app(), { email: `crowd${n}@corremadvisory.com` }),
      ),
    );
    const response = await call(asha, 'POST', '/v1/groups', {
      name: 'Everyone',
      memberIds: others,
    });
    expect(response.statusCode).toBe(200);
    const chatId = response.json().chat.id;
    expect(response.json().chat.group.memberCount).toBe(256);
    const { message } = await sendMessage(app(), {
      userId: asha.id,
      chatId,
      clientMsgId: uuidv7(),
      text: 'hello all',
    });
    const { UserUpdate, ChatMember } = chatModels(app());
    const logged = await UserUpdate.countDocuments({
      chatId: oid(chatId),
      kind: 'message',
      seq: message.seq,
    });
    expect(logged).toBe(256);
    // The chat lists catch up within a second, all in one write.
    await waitUntil(async () => {
      const moved = await ChatMember.countDocuments({
        chatId: oid(chatId),
        lastActivityAt: new Date(message.createdAt),
      });
      expect(moved).toBe(256);
    });
    const extra = await call(asha, 'POST', `/v1/chats/${chatId}/members`, {
      userIds: [(await person()).id],
    });
    expect(extra.json().code).toBe('GROUP_FULL');
  }, 120_000);
});

describe('indexes', () => {
  it('serves every group query', async () => {
    const { ChatMember, ReceiptEvent } = chatModels(app());
    const chatId = oid('a'.repeat(24));
    const userId = oid('b'.repeat(24));
    const active = { chatId, leftAt: null };
    await expectIndexedQuery(ChatMember.find({ userId }).sort({ lastActivityAt: -1, chatId: -1 }));
    await expectIndexedQuery(ChatMember.find({ userId, leftAt: null }));
    await expectIndexedQuery(ChatMember.find(active).sort({ joinedAt: 1 }));
    await expectIndexedQuery(ChatMember.findOne(active).sort({ lastDeliveredSeq: 1 }));
    await expectIndexedQuery(ChatMember.findOne(active).sort({ ackReadSeq: 1 }));
    await expectIndexedQuery(ReceiptEvent.find({ chatId, seq: { $gte: 1 } }).sort({ seq: 1 }));
  });
});

let listening: string | undefined;
const serverUrl = async () => {
  listening ??= await listen(app());
  return listening;
};
