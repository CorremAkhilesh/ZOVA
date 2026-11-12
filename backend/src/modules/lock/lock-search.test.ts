import { messageSearchResponseSchema } from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectIndexedQuery } from '../../../test/expect-indexed-query.ts';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { chatModels } from '../../chats/chats.service.ts';
import { lockModels, userOid } from '../../lock/lock-store.ts';
import { buildSearchQuery } from '../../search/message-search.service.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call, group, say } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
  // The text index must exist before searching (production builds it at deploy).
  await chatModels(built.app).Message.init();
});
afterAll(async () => {
  await built.cleanup();
});

const search = async (who: Person, q: string) => {
  const response = await call(who, 'GET', `/v1/search/messages?q=${encodeURIComponent(q)}`);
  expect(response.statusCode).toBe(200);
  return messageSearchResponseSchema.parse(response.json()).items;
};

describe('global search and locked chats', () => {
  it('never shows messages from chats I locked, for me only', async () => {
    const [asha, bharat] = [await person(), await person()];
    const secret = await group(asha, [bharat], 'Secret');
    const open = await group(asha, [bharat], 'Open');
    await say(bharat, secret, 'pineapple plans in the locked chat');
    await say(bharat, open, 'pineapple plans in the open chat');
    expect((await search(asha, 'pineapple')).length).toBe(2);

    await call(asha, 'PUT', '/v1/me/lock/pin', { pin: '1234' });
    await call(asha, 'PUT', `/v1/chats/${secret}/lock`, { locked: true });
    const mine = await search(asha, 'pineapple');
    expect(mine.map((hit) => hit.message.chatId)).toEqual([open]);
    expect(JSON.stringify(mine)).not.toContain('locked chat');
    // Bharat did not lock it.
    expect((await search(bharat, 'pineapple')).length).toBe(2);

    await call(asha, 'PUT', `/v1/chats/${secret}/lock`, { locked: false });
    expect((await search(asha, 'pineapple')).length).toBe(2);
  });
});

describe('lock and settings queries', () => {
  it('use an index', async () => {
    const asha = await person();
    const { Lock, LockCredential } = lockModels(app());
    const me = userOid(asha.id);
    await expectIndexedQuery(Lock.findById(me));
    await expectIndexedQuery(Lock.find({ _id: me, 'reset.expiresAt': { $gt: new Date() } }));
    await expectIndexedQuery(LockCredential.find({ userId: me }).sort({ createdAt: 1 }));
    await expectIndexedQuery(LockCredential.find({ credentialId: 'x', userId: me }));
    await expectIndexedQuery(
      chatModels(app()).ChatMember.find({ userId: me, leftAt: null, chatId: { $in: [me] } }),
    );
    const filter = await buildSearchQuery(app(), asha.id, { q: 'x', limit: 20 });
    if (filter) await expectIndexedQuery(chatModels(app()).Message.find(filter).sort({ _id: -1 }));
  });
});
