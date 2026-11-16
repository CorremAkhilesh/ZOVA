import { chatListResponseSchema, chatResponseSchema } from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectIndexedQuery } from '../../../test/expect-indexed-query.ts';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { chatModels, oid } from '../../chats/chats.service.ts';
import { expireDueMessages } from '../../chats/expiry.service.ts';
import { senderNameQuery } from '../../chats/sender-name.ts';

/**
 * A group's chat list says who sent the last message ("Asha: hi") straight away: the name travels
 * with the chat's lastMessage, so no member profile has to be loaded first.
 */
let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call, group, say, summary } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
});
afterAll(async () => {
  await built.cleanup();
});

const rename = async (who: Person, displayName: string) => {
  const response = await call(who, 'PATCH', '/v1/me/profile', { displayName });
  expect(response.statusCode).toBe(200);
};

describe('the sender name in a chat’s lastMessage', () => {
  it('names the sender of a group’s last message, in the list and in one chat', async () => {
    const [asha, bharat] = [await person(), await person()];
    await rename(asha, 'Asha Verma');
    const chatId = await group(asha, [bharat]);
    await say(asha, chatId, 'hello team');

    expect((await summary(bharat, chatId)).lastMessage).toMatchObject({
      preview: 'hello team',
      senderName: 'Asha Verma',
    });
    const list = chatListResponseSchema.parse((await call(bharat, 'GET', '/v1/chats')).json());
    expect(list.items.find((chat) => chat.id === chatId)?.lastMessage?.senderName).toBe(
      'Asha Verma',
    );
  });

  it('falls back to the start of the email, as the profile does', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await group(asha, [bharat]);
    await say(bharat, chatId, 'hi');
    const name = bharat.email.split('@')[0];
    expect((await summary(asha, chatId)).lastMessage?.senderName).toBe(name);
  });

  it('keeps the name it was sent with until the next message', async () => {
    const [asha, bharat] = [await person(), await person()];
    await rename(asha, 'Asha Verma');
    const chatId = await group(asha, [bharat]);
    await say(asha, chatId, 'one');
    await rename(asha, 'Asha V');
    expect((await summary(bharat, chatId)).lastMessage?.senderName).toBe('Asha Verma');
    await say(asha, chatId, 'two');
    expect((await summary(bharat, chatId)).lastMessage?.senderName).toBe('Asha V');
  });

  it('has none for a system message, nor in a direct chat', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await group(asha, [bharat]);
    expect((await summary(bharat, chatId)).lastMessage).toMatchObject({
      senderId: null,
      senderName: null,
    });
    const direct = chatResponseSchema.parse(
      (await call(asha, 'POST', '/v1/chats/direct', { userId: bharat.id })).json(),
    ).chat.id;
    await say(asha, direct, 'just us');
    expect((await summary(bharat, direct)).lastMessage?.senderName).toBeNull();
  });

  it('names the sender of the message before, when the last one is deleted for me', async () => {
    const [asha, bharat, chitra] = [await person(), await person(), await person()];
    await rename(asha, 'Asha Verma');
    const chatId = await group(asha, [bharat, chitra]);
    await say(asha, chatId, 'first');
    const { message } = await say(chitra, chatId, 'second');
    const removed = await call(
      bharat,
      'DELETE',
      `/v1/chats/${chatId}/messages/${message.id}?scope=me`,
    );
    expect(removed.statusCode).toBe(200);
    expect((await summary(bharat, chatId)).lastMessage).toMatchObject({
      preview: 'first',
      senderName: 'Asha Verma',
    });
  });

  it('names the sender of the message left when the last one disappears', async () => {
    const [asha, bharat] = [await person(), await person()];
    await rename(asha, 'Asha Verma');
    const chatId = await group(asha, [bharat]);
    await call(asha, 'PUT', `/v1/chats/${chatId}/disappearing`, { timer: '24h' });
    const kept = (await say(asha, chatId, 'stays')).message;
    await say(bharat, chatId, 'goes');
    // Only the newest is due, so the list moves back to Asha's.
    await chatModels(app()).Message.updateOne({ _id: oid(kept.id) }, { $set: { expiresAt: null } });
    expect(await expireDueMessages(app(), new Date(Date.now() + 25 * 3_600_000))).toBe(1);
    expect((await summary(bharat, chatId)).lastMessage).toMatchObject({
      preview: 'stays',
      senderName: 'Asha Verma',
    });
  });

  it('looks the sender up by id', async () => {
    const asha = await person();
    await expectIndexedQuery(senderNameQuery(app(), oid(asha.id)));
  });
});
