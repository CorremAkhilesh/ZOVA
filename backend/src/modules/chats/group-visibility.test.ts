import { chatListResponseSchema } from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { groupClient, texts } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { mediaClient, PDF } from '../../../test/media-helpers.ts';
import {
  closeAllSockets,
  connect,
  listen,
  record,
  uuidv7,
  waitUntil,
} from '../../../test/realtime-helpers.ts';
import { sendMessage } from '../../chats/messages.service.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call, group, say, history, summary } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
});
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

const add = (who: Person, chatId: string, target: Person) =>
  call(who, 'POST', `/v1/chats/${chatId}/members`, { userIds: [target.id] });
const remove = (who: Person, chatId: string, target: Person) =>
  call(who, 'DELETE', `/v1/chats/${chatId}/members/${target.id}`);
const cursorOf = async (who: Person) =>
  (await call(who, 'GET', '/v1/sync')).json().cursor as string;
const syncFrom = async (who: Person, cursor: string) =>
  (await call(who, 'GET', `/v1/sync?since=${cursor}`)).json();

async function sendFile(who: Person, chatId: string) {
  const mediaId = await mediaClient(app()).ready(who as never, 'document', 'a.pdf', PDF);
  await sendMessage(app(), { userId: who.id, chatId, clientMsgId: uuidv7(), mediaId });
  return mediaId;
}

const gallery = async (who: Person, chatId: string) =>
  (await call(who, 'GET', `/v1/chats/${chatId}/media?tab=docs`)).json();

describe('someone new', () => {
  it('sees only what was sent after they joined, in history', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await group(asha);
    await say(asha, chatId, 'before');
    await add(asha, chatId, bharat);
    await say(asha, chatId, 'after');
    expect(texts(await history(bharat, chatId))).toEqual(['after']);
    // Paging back cannot reach further either.
    const older = await call(bharat, 'GET', `/v1/chats/${chatId}/messages?before=3`);
    expect(texts(older.json().items)).toEqual([]);
    const asked = await call(bharat, 'GET', `/v1/chats/${chatId}/messages?after=0`);
    expect(texts(asked.json().items)).toEqual(['after']);
  });

  it('starts with nothing unread from before', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await group(asha);
    await say(asha, chatId, 'before');
    await add(asha, chatId, bharat);
    expect((await summary(bharat, chatId)).unreadCount).toBe(1);
  });

  it('cannot reach earlier files, in the gallery or by asking for them directly', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await group(asha);
    const early = await sendFile(asha, chatId);
    await add(asha, chatId, bharat);
    const late = await sendFile(asha, chatId);
    const files = (await gallery(bharat, chatId)).items.map(
      (item: { media: { id: string } }) => item.media.id,
    );
    expect(files).toEqual([late]);
    const media = mediaClient(app());
    expect((await media.content(bharat as never, early)).statusCode).toBe(404);
    expect((await media.content(bharat as never, late)).statusCode).toBe(200);
    const link = await call(bharat, 'GET', `/v1/media/${early}/link`);
    expect(link.statusCode).toBe(404);
  });

  it('hears nothing of the past through sync', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await group(asha);
    const cursor = await cursorOf(bharat);
    await say(asha, chatId, 'before');
    await add(asha, chatId, bharat);
    await say(asha, chatId, 'after');
    const page = await syncFrom(bharat, cursor);
    expect(texts(page.messages)).toEqual(['after']);
  });
});

describe('someone removed', () => {
  async function setup() {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await group(asha, [bharat]);
    await say(asha, chatId, 'before');
    await remove(asha, chatId, bharat);
    await say(asha, chatId, 'after');
    return { asha, bharat, chatId };
  }

  it('keeps history up to then, and nothing later', async () => {
    const { bharat, chatId } = await setup();
    const seen = await history(bharat, chatId);
    expect(texts(seen)).toEqual(['before']);
    expect(seen.at(-1)?.system?.kind).toBe('removed');
  });

  it('sees the group as it was, with no unread from after', async () => {
    const { asha, bharat, chatId } = await setup();
    await call(asha, 'PATCH', `/v1/chats/${chatId}/group`, { name: 'Secret new name' });
    const chat = await summary(bharat, chatId);
    expect(chat.group).toMatchObject({ active: false, name: 'Team' });
    expect(chat.lastMessage?.system?.kind).toBe('removed');
    expect(chat.seq).toBeLessThan((await summary(asha, chatId)).seq);
    expect(chat.unreadCount).toBeLessThanOrEqual(3);
  });

  it('still finds it in the chat list', async () => {
    const { bharat, chatId } = await setup();
    const list = chatListResponseSchema.parse((await call(bharat, 'GET', '/v1/chats')).json());
    expect(list.items.map((chat) => chat.id)).toContain(chatId);
  });

  it('gets nothing through sync after that', async () => {
    const { asha, bharat, chatId } = await setup();
    const cursor = await cursorOf(bharat);
    await say(asha, chatId, 'much later');
    const page = await syncFrom(bharat, cursor);
    expect(page.messages).toEqual([]);
  });

  it('hears the removal live, then nothing', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await group(asha, [bharat]);
    const socket = await connect(await serverUrl(), bharat.cookie);
    const heard = record(socket, 'message:new');
    const updates = record(socket, 'chat:updated');
    await remove(asha, chatId, bharat);
    await waitUntil(() => expect(heard).toHaveLength(1));
    expect(heard[0]?.message.system?.kind).toBe('removed');
    await waitUntil(() => expect(updates.at(-1)?.group?.active).toBe(false));
    await say(asha, chatId, 'secret');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(heard).toHaveLength(1);
  });

  it('cannot send, read further, mark read or list members', async () => {
    const { bharat, chatId } = await setup();
    await expect(say(bharat, chatId, 'still here?')).rejects.toThrow();
    expect((await call(bharat, 'GET', `/v1/chats/${chatId}/members`)).statusCode).toBe(404);
    const read = await call(bharat, 'POST', `/v1/chats/${chatId}/read`, { seq: 9 });
    expect(read.statusCode).toBe(404);
    expect((await call(bharat, 'POST', `/v1/chats/${chatId}/leave`)).statusCode).toBe(404);
  });

  it('keeps files from before, and cannot reach later ones', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await group(asha, [bharat]);
    const early = await sendFile(asha, chatId);
    await remove(asha, chatId, bharat);
    const late = await sendFile(asha, chatId);
    const media = mediaClient(app());
    expect((await media.content(bharat as never, early)).statusCode).toBe(200);
    expect((await media.content(bharat as never, late)).statusCode).toBe(404);
    const files = (await gallery(bharat, chatId)).items.map(
      (item: { media: { id: string } }) => item.media.id,
    );
    expect(files).toEqual([early]);
  });

  it('coming back sees only what is new', async () => {
    const { asha, bharat, chatId } = await setup();
    await add(asha, chatId, bharat);
    await say(asha, chatId, 'welcome back');
    expect(texts(await history(bharat, chatId))).toEqual(['welcome back']);
    expect((await summary(bharat, chatId)).group?.active).toBe(true);
  });
});

describe('someone who left', () => {
  it('is treated the same as someone removed', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await group(asha, [bharat]);
    await say(asha, chatId, 'before');
    const left = await call(bharat, 'POST', `/v1/chats/${chatId}/leave`);
    expect(left.json().chat.group.active).toBe(false);
    await say(asha, chatId, 'after');
    expect(texts(await history(bharat, chatId))).toEqual(['before']);
    expect((await summary(asha, chatId)).group?.memberCount).toBe(1);
  });
});

let listening: string | undefined;
const serverUrl = async () => {
  listening ??= await listen(app());
  return listening;
};
