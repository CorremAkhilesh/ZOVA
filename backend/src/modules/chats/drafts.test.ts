import { chatResponseSchema, draftResponseSchema, syncResponseSchema } from '@zuvo/protocol';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import {
  closeAllSockets,
  connect,
  listen,
  record,
  waitUntil,
} from '../../../test/realtime-helpers.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
let url: string;
const app = () => built.app;
const { person, call, summary } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
  url = await listen(built.app);
});
afterAll(async () => {
  closeAllSockets();
  await built.cleanup();
});

const direct = async (who: Person, other: Person) =>
  chatResponseSchema.parse(
    (await call(who, 'POST', '/v1/chats/direct', { userId: other.id })).json(),
  ).chat.id;
/** One fixed clock for the whole file: a slow request must not make "older" newer. */
const START = Date.now();
const at = (offsetMs: number) => new Date(START + offsetMs).toISOString();
const put = (who: Person | null, chatId: string, text: string, updatedAt: string, replyTo = null) =>
  call(who, 'PUT', `/v1/chats/${chatId}/draft`, { text, replyTo, updatedAt });

describe('drafts', () => {
  it('keep the newest write, and an older one never wins', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const first = draftResponseSchema.parse(
      (await put(asha, chatId, 'hello wor', at(-2000))).json(),
    );
    expect(first).toMatchObject({ applied: true, draft: { text: 'hello wor' } });
    const stale = draftResponseSchema.parse((await put(asha, chatId, 'hel', at(-5000))).json());
    expect(stale).toMatchObject({ applied: false, draft: { text: 'hello wor' } });
    await put(asha, chatId, 'hello world', at(-1000));
    expect((await summary(asha, chatId)).draft?.text).toBe('hello world');
  });

  it('clearing keeps its time, so an older draft from another device cannot come back', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    await put(asha, chatId, 'typing…', at(-3000));
    const cleared = draftResponseSchema.parse((await put(asha, chatId, '', at(-1000))).json());
    expect(cleared).toMatchObject({ applied: true, draft: { text: '', replyTo: null } });
    const late = draftResponseSchema.parse((await put(asha, chatId, 'typing…', at(-2000))).json());
    expect(late).toMatchObject({ applied: false, draft: { text: '' } });
    // Empty, but with its time: an older draft elsewhere knows to go.
    expect((await summary(asha, chatId)).draft).toMatchObject({ text: '', replyTo: null });
  });

  it('are mine alone, reach my other devices, and come with sync', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const since = syncResponseSchema.parse((await call(asha, 'GET', '/v1/sync')).json()).cursor;
    const other = await connect(url, asha.cookie);
    const heard = record(other, 'draft:updated');
    await put(asha, chatId, 'secret plan', at(0));
    await waitUntil(() =>
      expect(heard.at(-1)).toMatchObject({ chatId, draft: { text: 'secret plan' } }),
    );
    expect((await summary(bharat, chatId)).draft ?? null).toBeNull();
    const sync = syncResponseSchema.parse(
      (await call(asha, 'GET', `/v1/sync?since=${since}`)).json(),
    );
    expect(sync.chats.find((chat) => chat.id === chatId)?.draft?.text).toBe('secret plan');
  });

  it('a clock running ahead cannot hold the draft for long', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    await put(asha, chatId, 'from the future', at(3_600_000));
    const draft = (await summary(asha, chatId)).draft;
    expect(Date.parse(draft?.updatedAt ?? '')).toBeLessThan(Date.now() + 120_000);
  });

  it('refuses bad input, outsiders and the signed out', async () => {
    const [asha, bharat, outsider] = [await person(), await person(), await person()];
    const chatId = await direct(asha, bharat);
    expect((await put(asha, chatId, 'x'.repeat(4097), at(0))).statusCode).toBe(400);
    expect((await put(asha, chatId, 'ok', 'yesterday')).statusCode).toBe(400);
    expect((await put(outsider, chatId, 'ok', at(0))).statusCode).toBe(404);
    expect((await put(null, chatId, 'ok', at(0))).statusCode).toBe(401);
  });
});
