import { invitePreviewSchema, inviteResponseSchema } from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectIndexedQuery } from '../../../test/expect-indexed-query.ts';
import { groupClient, systemKinds, texts } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { chatModels, oid } from '../../chats/chats.service.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call, group, say, history, setRole, summary } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
});
afterAll(() => built.cleanup());

async function linkFor(who: Person, chatId: string) {
  const response = await call(who, 'POST', `/v1/chats/${chatId}/invite`);
  expect(response.statusCode).toBe(200);
  return inviteResponseSchema.parse(response.json()).code ?? '';
}

describe('the invite link', () => {
  it('is for admins to see and change', async () => {
    const [asha, bharat, stranger] = [await person(), await person(), await person()];
    const chatId = await group(asha, [bharat]);
    const url = `/v1/chats/${chatId}/invite`;
    expect((await call(bharat, 'POST', url)).statusCode).toBe(403);
    expect((await call(bharat, 'GET', url)).statusCode).toBe(403);
    expect((await call(bharat, 'DELETE', url)).statusCode).toBe(403);
    expect((await call(stranger, 'GET', url)).statusCode).toBe(404);
    expect((await call(null, 'GET', url)).statusCode).toBe(401);
    expect((await call(asha, 'GET', url)).json().code).toBeNull();
    await setRole(asha, chatId, bharat, 'admin');
    const code = await linkFor(bharat, chatId);
    expect((await call(asha, 'GET', url)).json().code).toBe(code);
  });

  it('shows the group to someone not in it, without any messages', async () => {
    const [asha, dinesh] = [await person(), await person()];
    const chatId = await group(asha, [], 'Launch');
    await say(asha, chatId, 'private');
    const code = await linkFor(asha, chatId);
    const preview = invitePreviewSchema.parse(
      (await call(dinesh, 'GET', `/v1/invites/${code}`)).json(),
    );
    expect(preview).toMatchObject({ chatId, name: 'Launch', memberCount: 1, alreadyMember: false });
    expect(JSON.stringify(preview)).not.toContain('private');
  });

  it('needs a session to look or join', async () => {
    const asha = await person();
    const code = await linkFor(asha, await group(asha));
    expect((await call(null, 'GET', `/v1/invites/${code}`)).statusCode).toBe(401);
    expect((await call(null, 'POST', `/v1/invites/${code}/join`)).statusCode).toBe(401);
  });

  it('lets someone join, seeing only what comes after', async () => {
    const [asha, dinesh] = [await person(), await person()];
    const chatId = await group(asha);
    await say(asha, chatId, 'before');
    const code = await linkFor(asha, chatId);
    const joined = await call(dinesh, 'POST', `/v1/invites/${code}/join`);
    expect(joined.statusCode).toBe(200);
    expect(joined.json().chat.group).toMatchObject({
      myRole: 'member',
      active: true,
      memberCount: 2,
    });
    await say(asha, chatId, 'after');
    const seen = await history(dinesh, chatId);
    expect(texts(seen)).toEqual(['after']);
    expect(systemKinds(seen)).toEqual(['joined']);
    expect(seen[0]?.system?.actor?.id).toBe(dinesh.id);
  });

  it('joining twice changes nothing', async () => {
    const [asha, dinesh] = [await person(), await person()];
    const chatId = await group(asha);
    const code = await linkFor(asha, chatId);
    await call(dinesh, 'POST', `/v1/invites/${code}/join`);
    await call(dinesh, 'POST', `/v1/invites/${code}/join`);
    expect((await summary(asha, chatId)).group?.memberCount).toBe(2);
    expect(systemKinds(await history(asha, chatId))).toEqual(['created', 'joined']);
    expect((await call(dinesh, 'GET', `/v1/invites/${code}`)).json().alreadyMember).toBe(true);
  });

  it('stops working when reset, and the new one works', async () => {
    const [asha, dinesh] = [await person(), await person()];
    const chatId = await group(asha);
    const old = await linkFor(asha, chatId);
    const fresh = await linkFor(asha, chatId);
    expect(fresh).not.toBe(old);
    expect((await call(dinesh, 'GET', `/v1/invites/${old}`)).statusCode).toBe(404);
    const refused = await call(dinesh, 'POST', `/v1/invites/${old}/join`);
    expect(refused.statusCode).toBe(404);
    expect(refused.json().code).toBe('INVITE_INVALID');
    expect((await call(dinesh, 'POST', `/v1/invites/${fresh}/join`)).statusCode).toBe(200);
  });

  it('stops working when revoked', async () => {
    const [asha, dinesh] = [await person(), await person()];
    const chatId = await group(asha);
    const code = await linkFor(asha, chatId);
    const gone = await call(asha, 'DELETE', `/v1/chats/${chatId}/invite`);
    expect(gone.json().code).toBeNull();
    expect((await call(dinesh, 'POST', `/v1/invites/${code}/join`)).statusCode).toBe(404);
  });

  it('refuses a made-up code like any other, and a malformed one', async () => {
    const dinesh = await person();
    expect((await call(dinesh, 'GET', `/v1/invites/${'a'.repeat(22)}`)).statusCode).toBe(404);
    expect((await call(dinesh, 'GET', '/v1/invites/!!')).statusCode).toBe(400);
  });

  it('cannot fill a group past 256', async () => {
    const [asha, dinesh] = [await person(), await person()];
    const chatId = await group(asha);
    const code = await linkFor(asha, chatId);
    await chatModels(app()).Chat.updateOne(
      { _id: oid(chatId) },
      { $set: { 'group.memberCount': 256 } },
    );
    const full = await call(dinesh, 'POST', `/v1/invites/${code}/join`);
    expect(full.json().code).toBe('GROUP_FULL');
  });

  it('is limited, so codes cannot be guessed at speed', async () => {
    const dinesh = await person();
    for (let n = 0; n < 30; n += 1)
      await call(dinesh, 'POST', `/v1/invites/${'a'.repeat(22)}/join`);
    const over = await call(dinesh, 'POST', `/v1/invites/${'a'.repeat(22)}/join`);
    expect(over.statusCode).toBe(429);
  });

  it('uses an index', async () => {
    await expectIndexedQuery(
      chatModels(app()).Chat.findOne({
        type: 'group',
        'group.inviteCode': { $eq: 'x', $type: 'string' },
      }),
    );
  });
});
