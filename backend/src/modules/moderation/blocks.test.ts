import {
  blockedContactsResponseSchema,
  blockResponseSchema,
  chatResponseSchema,
  publicProfileResponseSchema,
  userSearchResponseSchema,
} from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectIndexedQuery } from '../../../test/expect-indexed-query.ts';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import {
  closeAllSockets,
  connect,
  listen,
  record,
  send,
  waitUntil,
} from '../../../test/realtime-helpers.ts';
import { oid } from '../../chats/chats.service.ts';
import { moderationModels } from '../../moderation/blocks.service.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
let url: string;
const app = () => built.app;
const { person, call, group, say } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
  url = await listen(built.app);
});
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

const block = (who: Person | null, target: Person | { id: string }) =>
  call(who, 'PUT', `/v1/me/blocks/${target.id}`);
const unblock = (who: Person, target: Person) => call(who, 'DELETE', `/v1/me/blocks/${target.id}`);
const direct = async (who: Person, other: Person) =>
  chatResponseSchema.parse(
    (await call(who, 'POST', '/v1/chats/direct', { userId: other.id })).json(),
  ).chat;
const refusal = async (attempt: Promise<unknown>) => {
  const error = await attempt.then(
    () => null,
    (caught: unknown) => caught as { code?: string },
  );
  return error?.code ?? 'sent';
};

describe('blocking: the routes', () => {
  it('blocks, lists newest first, and unblocks; twice is the same as once', async () => {
    const [asha, bharat, chitra] = [await person(), await person(), await person()];
    const first = await block(asha, bharat);
    expect(blockResponseSchema.parse(first.json())).toEqual({ userId: bharat.id, blocked: true });
    expect((await block(asha, bharat)).statusCode).toBe(200);
    await block(asha, chitra);
    const list = blockedContactsResponseSchema.parse(
      (await call(asha, 'GET', '/v1/me/blocks')).json(),
    );
    expect(list.items.map((item) => item.user.id)).toEqual([chitra.id, bharat.id]);
    const gone = await unblock(asha, bharat);
    expect(blockResponseSchema.parse(gone.json()).blocked).toBe(false);
    const after = blockedContactsResponseSchema.parse(
      (await call(asha, 'GET', '/v1/me/blocks')).json(),
    );
    expect(after.items.map((item) => item.user.id)).toEqual([chitra.id]);
  });

  it('refuses bad ids, myself, unknown people and the signed out', async () => {
    const asha = await person();
    expect((await call(asha, 'PUT', '/v1/me/blocks/nope')).statusCode).toBe(400);
    expect((await block(asha, asha)).statusCode).toBe(400);
    expect((await block(asha, { id: '0123456789abcdef01234567' })).statusCode).toBe(404);
    expect((await block(null, asha)).statusCode).toBe(401);
    expect((await call(null, 'GET', '/v1/me/blocks')).statusCode).toBe(401);
  });

  it('is mine alone: my list never shows anyone else’s blocks', async () => {
    const [asha, bharat, chitra] = [await person(), await person(), await person()];
    await block(bharat, chitra);
    const list = blockedContactsResponseSchema.parse(
      (await call(asha, 'GET', '/v1/me/blocks')).json(),
    );
    expect(list.items).toEqual([]);
  });

  it('tells my other devices', async () => {
    const [asha, bharat] = [await person(), await person()];
    const other = await connect(url, asha.cookie);
    const heard = record(other, 'blocks:changed');
    await block(asha, bharat);
    await waitUntil(() => expect(heard).toEqual([{ userId: bharat.id, blocked: true }]));
  });
});

describe('blocking: what it stops', () => {
  it('no messages either way in our chat, until unblocked', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chat = await direct(asha, bharat);
    await say(asha, chat.id, 'hello');
    await block(bharat, asha);
    expect(await refusal(say(bharat, chat.id, 'I blocked you'))).toBe('BLOCKED');
    expect(await refusal(say(asha, chat.id, 'why?'))).toBe('CANNOT_MESSAGE');
    // The same over the socket, as the app sends.
    const socket = await connect(url, asha.cookie);
    const ack = await send(socket, chat.id, 'still there?');
    expect(ack).toMatchObject({ ok: false, error: { code: 'CANNOT_MESSAGE' } });
    await unblock(bharat, asha);
    expect(await refusal(say(asha, chat.id, 'back again'))).toBe('sent');
  });

  it('leaves groups alone', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await group(asha, [bharat]);
    await block(bharat, asha);
    expect(await refusal(say(asha, chatId, 'group news'))).toBe('sent');
    expect(await refusal(say(bharat, chatId, 'thanks'))).toBe('sent');
  });

  it('hides my about and photo from the person I blocked, everywhere', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chat = await direct(asha, bharat);
    await say(bharat, chat.id, 'hi');
    const before = publicProfileResponseSchema.parse(
      (await call(asha, 'GET', `/v1/users/${bharat.id}`)).json(),
    );
    expect(before.user.about).not.toBeNull();
    await block(bharat, asha);
    const profile = publicProfileResponseSchema.parse(
      (await call(asha, 'GET', `/v1/users/${bharat.id}`)).json(),
    );
    expect(profile.user).toMatchObject({ about: null, avatar: null });
    const summary = chatResponseSchema.parse(
      (await call(asha, 'GET', `/v1/chats/${chat.id}`)).json(),
    );
    expect(summary.chat.otherUser).toMatchObject({ about: null, avatar: null });
    // The one who blocked still sees as before.
    const mine = publicProfileResponseSchema.parse(
      (await call(bharat, 'GET', `/v1/users/${asha.id}`)).json(),
    );
    expect(mine.user.about).not.toBeNull();
    const photo = await call(asha, 'GET', `/v1/users/${bharat.id}/avatar`);
    expect(photo.statusCode).toBe(404);
  });

  it('keeps me out of people search for the person I blocked', async () => {
    const [asha, bharat] = [await person(), await person()];
    const find = async (who: Person, target: Person) =>
      userSearchResponseSchema
        .parse(
          (await call(who, 'GET', `/v1/users/search?q=${encodeURIComponent(target.email)}`)).json(),
        )
        .items.map((item) => item.id);
    expect(await find(asha, bharat)).toEqual([bharat.id]);
    await block(bharat, asha);
    expect(await find(asha, bharat)).toEqual([]);
    expect(await find(bharat, asha)).toEqual([asha.id]);
  });

  it('stops presence both ways, at once', async () => {
    const [asha, bharat] = [await person(), await person()];
    await direct(asha, bharat);
    const ashaSocket = await connect(url, asha.cookie);
    await connect(url, bharat.cookie);
    const watch = () =>
      ashaSocket.timeout(10_000).emitWithAck('presence:subscribe', { userIds: [bharat.id] });
    await waitUntil(async () =>
      expect(await watch()).toMatchObject({ ok: true, data: { users: [{ online: true }] } }),
    );
    const resubscribe = record(ashaSocket, 'presence:resubscribe');
    await block(bharat, asha);
    await waitUntil(() => expect(resubscribe.length).toBeGreaterThan(0));
    expect(await watch()).toMatchObject({
      ok: true,
      data: { users: [{ userId: bharat.id, online: false, lastSeenAt: null }] },
    });
  });

  it('says nothing about typing', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chat = await direct(asha, bharat);
    const ashaSocket = await connect(url, asha.cookie);
    const bharatSocket = await connect(url, bharat.cookie);
    const typing = record(bharatSocket, 'typing:update');
    await block(bharat, asha);
    const ack = await ashaSocket.timeout(10_000).emitWithAck('typing:start', { chatId: chat.id });
    expect(ack.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(typing).toEqual([]);
  });
});

describe('blocking: indexes', () => {
  it('every block query uses an index', async () => {
    const { Block } = moderationModels(app());
    const [a, b] = [oid('0123456789abcdef01234567'), oid('0123456789abcdef01234568')];
    await expectIndexedQuery(Block.find({ userId: a, blockedId: b }));
    await expectIndexedQuery(
      Block.find({
        $or: [
          { userId: a, blockedId: b },
          { userId: b, blockedId: a },
        ],
      }),
    );
    await expectIndexedQuery(Block.find({ userId: a }).sort({ createdAt: -1, _id: -1 }));
    await expectIndexedQuery(Block.find({ blockedId: a, userId: { $in: [b] } }));
    await expectIndexedQuery(Block.find({ blockedId: a }));
    await expectIndexedQuery(
      Block.find({
        $or: [
          { userId: a, blockedId: { $in: [b] } },
          { blockedId: a, userId: { $in: [b] } },
        ],
      }),
    );
  });
});
