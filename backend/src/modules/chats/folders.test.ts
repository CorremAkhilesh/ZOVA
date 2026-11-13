import { chatResponseSchema, FOLDERS_MAX, foldersResponseSchema } from '@zuvo/protocol';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expectIndexedQuery } from '../../../test/expect-indexed-query.ts';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import {
  closeAllSockets,
  connect,
  listen,
  record,
  waitUntil,
} from '../../../test/realtime-helpers.ts';
import { registerFolderModels } from '../../db/folder-models.ts';

let built: Awaited<ReturnType<typeof buildTestApp>>;
let url: string;
const app = () => built.app;
const { person, call, group } = groupClient(app);
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
const create = (who: Person | null, body: object) => call(who, 'POST', '/v1/me/folders', body);
const list = async (who: Person) =>
  foldersResponseSchema.parse((await call(who, 'GET', '/v1/me/folders')).json()).folders;

describe('chat folders', () => {
  it('create with chats and rules, edit, reorder and delete', async () => {
    const [asha, bharat] = [await person(), await person()];
    const chatId = await direct(asha, bharat);
    const work = (
      await create(asha, { name: ' Work ', emoji: '💼', chatIds: [chatId, chatId] })
    ).json().folder;
    expect(work).toMatchObject({ name: 'Work', emoji: '💼', chatIds: [chatId] });
    expect(work.rules).toMatchObject({ groups: false, excludeArchived: true });
    const family = (
      await create(asha, {
        name: 'Family',
        rules: {
          groups: true,
          direct: false,
          unread: false,
          excludeMuted: true,
          excludeArchived: true,
        },
      })
    ).json().folder;
    const renamed = await call(asha, 'PATCH', `/v1/me/folders/${work.id}`, {
      name: 'Office',
      emoji: null,
    });
    expect(renamed.json().folder).toMatchObject({ name: 'Office', emoji: null });
    const reordered = await call(asha, 'PUT', '/v1/me/folders/order', {
      ids: [family.id, work.id],
    });
    expect(foldersResponseSchema.parse(reordered.json()).folders.map((f) => f.name)).toEqual([
      'Family',
      'Office',
    ]);
    expect((await call(asha, 'DELETE', `/v1/me/folders/${family.id}`)).statusCode).toBe(200);
    expect((await list(asha)).map((folder) => folder.name)).toEqual(['Office']);
  });

  it(`stops at ${FOLDERS_MAX}`, async () => {
    const asha = await person();
    for (let n = 0; n < FOLDERS_MAX; n++) {
      expect((await create(asha, { name: `F${n}` })).statusCode).toBe(200);
    }
    const refused = await create(asha, { name: 'one too many' });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('FOLDER_LIMIT_REACHED');
  });

  it('holds only my own chats, and stays mine alone', async () => {
    const [asha, bharat, chitra] = [await person(), await person(), await person()];
    const theirs = await group(bharat, [chitra]);
    expect((await create(asha, { name: 'Spy', chatIds: [theirs] })).statusCode).toBe(400);
    const mine = (await create(asha, { name: 'Mine' })).json().folder.id;
    expect((await call(bharat, 'PATCH', `/v1/me/folders/${mine}`, { name: 'x' })).statusCode).toBe(
      404,
    );
    expect((await call(bharat, 'DELETE', `/v1/me/folders/${mine}`)).statusCode).toBe(404);
    expect(await list(bharat)).toEqual([]);
  });

  it('refuses bad input, a partial reorder and the signed out', async () => {
    const asha = await person();
    expect((await create(asha, { name: '' })).statusCode).toBe(400);
    expect((await create(asha, { name: 'x'.repeat(25) })).statusCode).toBe(400);
    expect((await create(asha, { name: 'x', emoji: 'abc' })).statusCode).toBe(400);
    expect((await create(asha, { name: 'x', chatIds: ['nope'] })).statusCode).toBe(400);
    const one = (await create(asha, { name: 'One' })).json().folder.id;
    await create(asha, { name: 'Two' });
    expect((await call(asha, 'PUT', '/v1/me/folders/order', { ids: [one] })).statusCode).toBe(400);
    expect((await call(asha, 'PATCH', `/v1/me/folders/${one}`, {})).statusCode).toBe(400);
    expect((await create(null, { name: 'x' })).statusCode).toBe(401);
    expect((await call(null, 'GET', '/v1/me/folders')).statusCode).toBe(401);
  });

  it('tells my other devices', async () => {
    const asha = await person();
    const other = await connect(url, asha.cookie);
    const heard = record(other, 'folders:updated');
    await create(asha, { name: 'Work' });
    await waitUntil(() => expect(heard).toHaveLength(1));
  });

  it('every folder query uses an index', async () => {
    const { Folder } = registerFolderModels(app().mongo);
    const userId = new Types.ObjectId();
    await expectIndexedQuery(Folder.find({ userId }).sort({ order: 1 }));
    await expectIndexedQuery(Folder.find({ userId }).sort({ order: -1 }).limit(1));
    await expectIndexedQuery(Folder.findOne({ _id: new Types.ObjectId(), userId }));
  });
});
