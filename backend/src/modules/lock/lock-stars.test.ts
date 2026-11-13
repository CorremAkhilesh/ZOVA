import { starsResponseSchema } from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call, group, say } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
});
afterAll(async () => {
  await built.cleanup();
});

const stars = async (who: Person, query = '') => {
  const response = await call(who, 'GET', `/v1/stars${query}`);
  expect(response.statusCode).toBe(200);
  // Contract: every answer matches the protocol.
  return starsResponseSchema.parse(response.json());
};
const star = async (who: Person, chatId: string, text: string) => {
  const { message } = await say(who, chatId, text);
  await call(who, 'PUT', `/v1/chats/${chatId}/messages/${message.id}/star`);
};

describe('starred messages and locked chats', () => {
  it('leaves out chats I locked unless the app asks for them, for me only', async () => {
    const [asha, bharat] = [await person(), await person()];
    const secret = await group(asha, [bharat], 'Secret');
    const open = await group(asha, [bharat], 'Open');
    await star(asha, secret, 'the locked plan');
    await star(asha, open, 'the open plan');
    await star(bharat, secret, 'his');
    expect((await stars(asha)).items).toHaveLength(2);

    await call(asha, 'PUT', '/v1/me/lock/pin', { pin: '1234' });
    await call(asha, 'PUT', `/v1/chats/${secret}/lock`, { locked: true });
    const hidden = await stars(asha);
    expect(hidden.items.map((item) => item.message.chatId)).toEqual([open]);
    expect(hidden.lockedHidden).toBe(true);
    expect(JSON.stringify(hidden)).not.toContain('locked plan');
    // One chat: the same rule.
    const inSecret = await stars(asha, `?chatId=${secret}`);
    expect(inSecret).toMatchObject({ items: [], lockedHidden: true });
    expect((await stars(asha, `?chatId=${secret}&includeLocked=false`)).items).toEqual([]);

    // While the app's PIN unlock lasts, it asks for them.
    const unlocked = await stars(asha, '?includeLocked=true');
    expect(unlocked.items).toHaveLength(2);
    expect(unlocked.lockedHidden).toBeUndefined();
    // Bharat did not lock it.
    expect((await stars(bharat)).items).toHaveLength(1);

    await call(asha, 'PUT', `/v1/chats/${secret}/lock`, { locked: false });
    expect((await stars(asha)).items).toHaveLength(2);
  });

  it('refuses a bad flag and the signed out', async () => {
    const asha = await person();
    expect((await call(asha, 'GET', '/v1/stars?includeLocked=yes')).statusCode).toBe(400);
    expect((await call(null, 'GET', '/v1/stars?includeLocked=true')).statusCode).toBe(401);
  });
});
