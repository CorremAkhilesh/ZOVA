import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { groupClient, texts } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { mediaClient, PDF } from '../../../test/media-helpers.ts';
import { closeAllSockets, uuidv7 } from '../../../test/realtime-helpers.ts';
import { chatModels, oid } from '../../chats/chats.service.ts';
import { sendMessage } from '../../chats/messages.service.ts';
import { cleanupDeletedMedia } from '../../media/media-access.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call, group, say, history } = groupClient(app);
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
const direct = async (who: Person, other: Person) =>
  (await call(who, 'POST', '/v1/chats/direct', { userId: other.id })).json().chat.id as string;
const url = (chatId: string, messageId: string, tail = '') =>
  `/v1/chats/${chatId}/messages/${messageId}${tail}`;

const forward = (
  who: Person | null,
  from: string,
  messageId: string,
  chatIds: string[],
  extra: object = {},
) =>
  call(who, 'POST', '/v1/forward', {
    forwardId: crypto.randomUUID(),
    messages: [{ chatId: from, messageId }],
    chatIds,
    ...extra,
  });

async function sendFile(who: Person, chatId: string) {
  const mediaId = await mediaClient(app()).ready(who as never, 'document', 'a.pdf', PDF);
  const { message } = await sendMessage(app(), {
    userId: who.id,
    chatId,
    clientMsgId: uuidv7(),
    mediaId,
  });
  return { mediaId, messageId: message.id };
}

describe('forward', () => {
  it('copies to several chats with a label, and an optional message after it', async () => {
    const [asha, bharat, chitra] = [await person(), await person(), await person()];
    const from = await direct(asha, bharat);
    const [one, two] = [await direct(asha, chitra), await group(asha, [chitra])];
    const { message } = await say(bharat, from, 'news');
    const response = await forward(asha, from, message.id, [one, two], { comment: 'see this' });
    expect(response.statusCode).toBe(200);
    expect(response.json().sent).toBe(2);
    const items = await history(chitra, one);
    expect(texts(items)).toEqual(['news', 'see this']);
    expect(items[0]).toMatchObject({ forwarded: true, senderId: asha.id });
    expect(items[1]?.forwarded).toBe(false);
    expect(texts(await history(chitra, two))).toContain('news');
  });

  it('asking twice with the same id sends and counts once', async () => {
    const [asha, bharat] = [await person(), await person()];
    const from = await direct(asha, bharat);
    const self = await group(asha);
    const { message } = await say(bharat, from, 'news');
    const forwardId = crypto.randomUUID();
    await forward(asha, from, message.id, [self], { forwardId });
    const again = await forward(asha, from, message.id, [self], { forwardId });
    expect(again.json().sent).toBe(0);
    const copies = (await history(asha, self)).filter((item) => item.text === 'news');
    expect(copies).toHaveLength(1);
    const [original] = await history(asha, from);
    expect(original?.forwardCount).toBe(1);
  });

  it('counts: the fifth forward and later are "many times", through copies as well', async () => {
    const [asha, bharat] = [await person(), await person()];
    const from = await direct(asha, bharat);
    const target = await group(asha);
    const { message } = await say(bharat, from, 'viral');
    for (let round = 0; round < 4; round += 1) await forward(asha, from, message.id, [target]);
    const copies = (await history(asha, target)).filter((item) => item.text === 'viral');
    expect(copies.map((item) => item.forwardCount)).toEqual([1, 2, 3, 4]);
    const last = copies.at(-1)?.id as string;
    await forward(asha, target, last, [from]);
    const result = (await history(asha, from)).filter((item) => item.forwarded);
    expect(result.at(-1)?.forwardCount).toBe(5);
  });

  it('refuses more than 5 chats, nothing, and the signed out', async () => {
    const [asha, bharat] = [await person(), await person()];
    const from = await direct(asha, bharat);
    const { message } = await say(asha, from, 'x');
    const six = Array.from({ length: 6 }, () => from);
    expect((await forward(asha, from, message.id, six)).statusCode).toBe(400);
    expect((await forward(asha, from, message.id, [])).statusCode).toBe(400);
    expect((await forward(null, from, message.id, [from])).statusCode).toBe(401);
  });

  it('only what I can see, and only into chats where I may write', async () => {
    const [owner, late, outsider] = [await person(), await person(), await person()];
    const room = await group(owner);
    const { message } = await say(owner, room, 'before you');
    await add(owner, room, late);
    const lateOwn = await group(late);
    expect((await forward(late, room, message.id, [lateOwn])).statusCode).toBe(404);
    expect((await forward(outsider, room, message.id, [lateOwn])).statusCode).toBe(404);
    const after = await say(owner, room, 'after');
    const notTheirs = await group(owner);
    expect((await forward(late, room, after.message.id, [notTheirs])).statusCode).toBe(404);
  });

  it('refuses a deleted message', async () => {
    const [asha, bharat] = [await person(), await person()];
    const from = await direct(asha, bharat);
    const { message } = await say(asha, from, 'gone');
    await call(asha, 'DELETE', url(from, message.id, '?scope=everyone'));
    expect((await forward(asha, from, message.id, [from])).statusCode).toBe(400);
  });
});

describe('forwarded media', () => {
  it('shares the file: no upload, and someone new can open it', async () => {
    const [asha, bharat, chitra] = [await person(), await person(), await person()];
    const from = await direct(asha, bharat);
    const to = await direct(bharat, chitra);
    const { mediaId, messageId } = await sendFile(asha, from);
    expect((await forward(bharat, from, messageId, [to])).statusCode).toBe(200);
    const [copy] = await history(chitra, to);
    expect(copy?.media?.id).toBe(mediaId);
    expect((await call(chitra, 'GET', `/v1/media/${mediaId}/link`)).statusCode).toBe(200);
    const stranger = await person();
    expect((await call(stranger, 'GET', `/v1/media/${mediaId}/link`)).statusCode).toBe(404);
  });

  it('the file stays while a copy uses it, and goes with the last one', async () => {
    const [asha, bharat] = [await person(), await person()];
    const from = await direct(asha, bharat);
    const to = await group(bharat);
    const { mediaId, messageId } = await sendFile(asha, from);
    await forward(bharat, from, messageId, [to]);
    const { Media } = chatModels(app());
    await call(asha, 'DELETE', url(from, messageId, '?scope=everyone'));
    expect(await Media.findById(oid(mediaId)).lean()).toMatchObject({
      deleteRequestedAt: expect.any(Date),
    });
    await cleanupDeletedMedia(app());
    const kept = await Media.findById(oid(mediaId)).lean();
    expect(kept).not.toBeNull();
    expect(kept?.deleteRequestedAt).toBeUndefined();

    const copy = (await history(bharat, to)).find((item) => item.media);
    await call(bharat, 'DELETE', url(to, copy?.id as string, '?scope=everyone'));
    expect(await cleanupDeletedMedia(app())).toBeGreaterThanOrEqual(1);
    expect(await Media.findById(oid(mediaId)).lean()).toBeNull();
  });
});
