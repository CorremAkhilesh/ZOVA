import { chatResponseSchema } from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { checkRanges } from '../../chats/mentions.ts';
import { sendMessage } from '../../chats/messages.service.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
let url: string;
const app = () => built.app;
const { person, call, group, history, summary, setRole } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
  url = await listen(built.app);
});
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

/** "hi @Name": a mention of `who` at the end of the text. */
const mentioning = (prefix: string, who: Person, name = 'Name') => ({
  text: `${prefix}@${name}`,
  mentions: [{ userId: who.id, offset: prefix.length, length: name.length + 1 }],
});
const send = (who: Person, chatId: string, body: object) =>
  sendMessage(app(), { userId: who.id, chatId, clientMsgId: uuidv7(), ...body });
const code = async (attempt: Promise<unknown>) =>
  attempt.then(
    () => 'sent',
    (error: { code?: string }) => error.code,
  );

describe('mentions', () => {
  it('give the person named an "@" until they read it, and travel with the message', async () => {
    const [asha, bharat, chitra] = [await person(), await person(), await person()];
    const chatId = await group(asha, [bharat, chitra]);
    const socket = await connect(url, bharat.cookie);
    const updates = record(socket, 'chat:updated');
    const { message } = await send(asha, chatId, mentioning('hi ', bharat));
    expect((await summary(bharat, chatId)).mentionSeqs).toEqual([message.seq]);
    expect((await summary(chitra, chatId)).mentionSeqs).toEqual([]);
    await waitUntil(() =>
      expect(updates.some((update) => update.mentionSeqs?.includes(message.seq))).toBe(true),
    );
    const [stored] = (await history(chitra, chatId)).slice(-1);
    expect(stored?.mentions).toEqual([{ userId: bharat.id, offset: 3, length: 5 }]);
    await call(bharat, 'POST', `/v1/chats/${chatId}/read`, { seq: message.seq });
    expect((await summary(bharat, chatId)).mentionSeqs).toEqual([]);
  });

  it('@everyone: admins only, everyone but the sender, and never once the group turns it off', async () => {
    const [owner, member, other] = [await person(), await person(), await person()];
    const chatId = await group(owner, [member, other]);
    const everyone = { text: 'meeting now @everyone', mentionsEveryone: true };
    expect(await code(send(member, chatId, everyone))).toBe('FORBIDDEN');
    const { message } = await send(owner, chatId, everyone);
    expect(message.mentionsEveryone).toBe(true);
    for (const who of [member, other]) {
      expect((await summary(who, chatId)).mentionSeqs).toEqual([message.seq]);
    }
    expect((await summary(owner, chatId)).mentionSeqs).toEqual([]);
    await setRole(owner, chatId, member, 'admin');
    await call(owner, 'PUT', `/v1/chats/${chatId}/group/settings`, { mentionEveryone: 'off' });
    expect(await code(send(owner, chatId, everyone))).toBe('FORBIDDEN');
    expect(await code(send(owner, chatId, { text: 'no tag', mentionsEveryone: true }))).not.toBe(
      'sent',
    );
  });

  it('only members, only groups, only at an @ in the text', async () => {
    const [asha, bharat, outsider] = [await person(), await person(), await person()];
    const chatId = await group(asha, [bharat]);
    expect(await code(send(asha, chatId, mentioning('hi ', outsider)))).toBe('BAD_REQUEST');
    expect(await code(send(asha, chatId, mentioning('hi ', asha)))).toBe('BAD_REQUEST');
    const wrong = { text: 'hi Name', mentions: [{ userId: bharat.id, offset: 3, length: 4 }] };
    expect(await code(send(asha, chatId, wrong))).toBe('BAD_REQUEST');
    const past = { text: 'hi @B', mentions: [{ userId: bharat.id, offset: 3, length: 9 }] };
    expect(await code(send(asha, chatId, past))).toBe('BAD_REQUEST');
    const directId = chatResponseSchema.parse(
      (await call(asha, 'POST', '/v1/chats/direct', { userId: bharat.id })).json(),
    ).chat.id;
    expect(await code(send(asha, directId, mentioning('hi ', bharat)))).toBe('BAD_REQUEST');
  });

  it('an edit changes who is mentioned, and the "@" follows', async () => {
    const [asha, bharat, chitra] = [await person(), await person(), await person()];
    const chatId = await group(asha, [bharat, chitra]);
    const { message } = await send(asha, chatId, mentioning('ask ', bharat, 'Bharat'));
    const edit = await call(asha, 'PATCH', `/v1/chats/${chatId}/messages/${message.id}`, {
      text: 'ask @Chitra',
      mentions: [{ userId: chitra.id, offset: 4, length: 7 }],
    });
    expect(edit.statusCode).toBe(200);
    expect((await summary(bharat, chatId)).mentionSeqs).toEqual([]);
    expect((await summary(chitra, chatId)).mentionSeqs).toEqual([message.seq]);
    const [stored] = (await history(bharat, chatId)).slice(-1);
    expect(stored?.mentions).toEqual([{ userId: chitra.id, offset: 4, length: 7 }]);
    await call(asha, 'PATCH', `/v1/chats/${chatId}/messages/${message.id}`, { text: 'never mind' });
    expect((await summary(chitra, chatId)).mentionSeqs).toEqual([]);
  });

  it('clearing the chat clears the "@"', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await group(asha, [bharat]);
    await send(asha, chatId, mentioning('hey ', bharat));
    await call(bharat, 'POST', `/v1/chats/${chatId}/clear`);
    expect((await summary(bharat, chatId)).mentionSeqs).toEqual([]);
  });
});

describe('mention ranges', () => {
  it('must each point at an @, in order, without overlapping', () => {
    const at = (offset: number, length: number) => ({ userId: 'u', offset, length });
    expect(checkRanges('@a and @b', [at(7, 2), at(0, 2)]).map((m) => m.offset)).toEqual([0, 7]);
    expect(() => checkRanges('@abc', [at(0, 4), at(2, 2)])).toThrow('overlap');
    expect(() => checkRanges('abc', [at(0, 2)])).toThrow('@name');
    expect(() => checkRanges('@a', [at(0, 5)])).toThrow('@name');
  });
});
