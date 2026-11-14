import { chatResponseSchema, scheduledResponseSchema } from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call, history } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
});
afterAll(async () => {
  await built.cleanup();
});

const direct = async (who: Person, other: Person) =>
  chatResponseSchema.parse(
    (await call(who, 'POST', '/v1/chats/direct', { userId: other.id })).json(),
  ).chat.id;
const scheduleIn = async (who: Person, chatId: string, text: string, minutes: number) => {
  const sendAt = new Date(Date.now() + minutes * 60_000).toISOString();
  const response = await call(who, 'POST', '/v1/me/scheduled', { chatId, text, sendAt });
  expect(response.statusCode).toBe(200);
  return scheduledResponseSchema.parse(response.json()).item;
};

describe('POST /v1/test/run-scheduled', () => {
  it('sends my waiting messages in that chat now, and nobody else’s', async () => {
    const [asha, bharat, chitra] = [await person(), await person(), await person()];
    const chatId = await direct(asha, bharat);
    const otherChat = await direct(asha, chitra);
    await scheduleIn(asha, chatId, 'in an hour', 60);
    await scheduleIn(bharat, chatId, 'from bharat', 60);
    await scheduleIn(asha, otherChat, 'elsewhere', 60);

    const response = await call(asha, 'POST', '/v1/test/run-scheduled', { chatId });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ sent: 1 });
    expect((await history(bharat, chatId)).map((message) => message.text)).toEqual(['in an hour']);
    expect(await history(chitra, otherChat)).toEqual([]);

    // Nothing left waiting: a second run sends nothing.
    expect((await call(asha, 'POST', '/v1/test/run-scheduled', { chatId })).json()).toEqual({
      sent: 0,
    });
  });

  it('needs a session and a chat id', async () => {
    const asha = await person();
    expect((await call(asha, 'POST', '/v1/test/run-scheduled', {})).statusCode).toBe(400);
    const chatId = '0123456789abcdef01234567';
    expect((await call(null, 'POST', '/v1/test/run-scheduled', { chatId })).statusCode).toBe(401);
  });
});
