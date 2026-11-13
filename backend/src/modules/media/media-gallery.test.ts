import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { headers } from '../../../test/auth-helpers.ts';
import { expectIndexedQuery } from '../../../test/expect-indexed-query.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { mediaClient, PDF, png } from '../../../test/media-helpers.ts';
import { signedIn, uuidv7 } from '../../../test/realtime-helpers.ts';
import { chatModels, getOrCreateDirectChat, oid } from '../../chats/chats.service.ts';
import { sendMessage } from '../../chats/messages.service.ts';
import { cleanupOrphans, MAX_OPEN_UPLOADS, ORPHAN_AGE_MS } from '../../media/media.service.ts';

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => ctx.app;
type Person = Awaited<ReturnType<typeof signedIn>>;
let seed = 0;
const person = () => signedIn(app(), `mg${++seed}@corremadvisory.com`);
const client = () => mediaClient(app());
const start: ReturnType<typeof mediaClient>['start'] = (...args) => client().start(...args);
const ready: ReturnType<typeof mediaClient>['ready'] = (...args) => client().ready(...args);

async function chatOf() {
  const alice = await person();
  const bob = await person();
  const { id: chatId } = await getOrCreateDirectChat(app(), alice.id, bob.id);
  return { alice, bob, chatId };
}

const attach = (who: Person, chatId: string, mediaId: string, text?: string) =>
  sendMessage(app(), { userId: who.id, chatId, clientMsgId: uuidv7(), mediaId, text });

beforeAll(async () => {
  ctx = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
});
afterAll(async () => {
  await ctx.cleanup();
});

describe('limits and cleanup', () => {
  it('limits how many uploads one person has open', async () => {
    const who = await person();
    const body = { kind: 'document', name: 'a.pdf', mime: 'x', size: 100 };
    for (let n = 0; n < MAX_OPEN_UPLOADS; n++) {
      expect((await start(who, body)).statusCode).toBe(200);
    }
    const refused = await start(who, body);
    expect(refused.statusCode).toBe(429);
    expect(refused.json().code).toBe('RATE_LIMITED');
    // Someone else is unaffected.
    expect((await start(await person(), body)).statusCode).toBe(200);
  });

  it('limits how fast uploads can be started', async () => {
    const who = await person();
    const spy = vi.spyOn(app().counterStore, 'increment').mockResolvedValue(61);
    const refused = await start(who, { kind: 'document', name: 'a.pdf', mime: 'x', size: 100 });
    spy.mockRestore();
    expect(refused.statusCode).toBe(429);
  });

  it('removes uploads never attached within a day, and nothing else', async () => {
    const { alice, chatId } = await chatOf();
    const attached = await ready(alice, 'document', 'keep.pdf', PDF);
    await attach(alice, chatId, attached);
    const recent = await ready(alice, 'document', 'recent.pdf', PDF);
    const old = await ready(alice, 'image', 'old.png', await png());
    const { Media } = chatModels(app());
    const stale = await Media.findById(old).lean();

    const later = new Date(Date.now() + ORPHAN_AGE_MS + 60_000);
    await Media.updateMany(
      { _id: { $in: [oid(recent)] } },
      { $set: { createdAt: new Date(Date.now() + ORPHAN_AGE_MS) } },
    );
    await cleanupOrphans(app(), later);

    expect(await Media.findById(old).lean()).toBeNull();
    expect(await app().storage.exists(stale?.storageKey ?? '')).toBe(false);
    expect(await app().storage.exists(stale?.thumbnailKey ?? '')).toBe(false);
    expect(await Media.findById(attached).lean()).not.toBeNull();
    expect(await Media.findById(recent).lean()).not.toBeNull();
  });
});

describe('the gallery', () => {
  it('lists media or documents, newest first, members only', async () => {
    const { alice, bob, chatId } = await chatOf();
    const stranger = await person();
    for (const [kind, name, bytes] of [
      ['image', '1.png', await png()],
      ['document', 'a.pdf', PDF],
      ['image', '2.png', await png()],
    ] as const) {
      await attach(alice, chatId, await ready(alice, kind, name, bytes));
    }
    const get = (who: Person, query: string) =>
      app().inject({
        method: 'GET',
        url: `/v1/chats/${chatId}/media?${query}`,
        headers: headers(who.cookie),
      });
    const media = (await get(bob, 'tab=media')).json();
    expect(media.items.map((message: { seq: number }) => message.seq)).toEqual([3, 1]);
    const docs = (await get(bob, 'tab=docs')).json();
    expect(docs.items.map((message: { seq: number }) => message.seq)).toEqual([2]);
    const older = (await get(bob, 'tab=media&before=3')).json();
    expect(older.items.map((message: { seq: number }) => message.seq)).toEqual([1]);
    expect((await get(stranger, 'tab=media')).statusCode).toBe(404);
  });

  it('every query uses an index', async () => {
    const { Media, Message } = chatModels(app());
    const chatId = oid('0'.repeat(24));
    await expectIndexedQuery(
      Message.find({ chatId, type: { $in: ['image', 'video'] }, seq: { $lt: 9 } })
        .sort({ seq: -1 })
        .limit(61),
    );
    await expectIndexedQuery(
      Media.find({ ownerId: chatId, status: 'pending', createdAt: { $gt: new Date() } }),
    );
    await expectIndexedQuery(Media.find({ messageId: null, createdAt: { $lt: new Date() } }));
  });
});
