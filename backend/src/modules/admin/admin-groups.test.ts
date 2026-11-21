import { adminGroupsResponseSchema, syncResponseSchema } from '@zuvo/protocol';
import { Types } from 'mongoose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { groupClient } from '../../../test/group-helpers.ts';
import { buildTestApp } from '../../../test/helpers.ts';
import { signedIn } from '../../../test/realtime-helpers.ts';
import { chatModels } from '../../chats/chats.service.ts';

// Admin → Groups: list without reading, archive (read only), restore, delete for everyone.

let built: Awaited<ReturnType<typeof buildTestApp>>;
const app = () => built.app;
const { person, call, group, say, history, summary } = groupClient(app);
type Person = Awaited<ReturnType<typeof person>>;
let admin: Person;
const WHY = { reason: 'Reported for spam' };

beforeAll(async () => {
  built = await buildTestApp({}, { OTP_IP_LIMIT_PER_HOUR: '1000' });
  admin = await signedIn(built.app, 'admin@corremadvisory.com');
});
afterAll(async () => {
  await built.cleanup();
});

const groups = async (query = '') =>
  adminGroupsResponseSchema.parse((await call(admin, 'GET', `/v1/admin/groups${query}`)).json())
    .items;
const act = (id: string, what: 'archive' | 'restore', body: object = WHY) =>
  call(admin, 'POST', `/v1/admin/groups/${id}/${what}`, body);

describe('the list', () => {
  it('shows size, admins, owner, activity and storage; searches and filters', async () => {
    const [owner, b, c] = [await person(), await person(), await person()];
    const id = await group(owner, [b, c], 'Design Guild');
    await chatModels(app()).Media.create({
      ownerId: new Types.ObjectId(owner.id),
      chatId: new Types.ObjectId(id),
      kind: 'document',
      mime: 'application/pdf',
      size: 4096,
      name: 'brief.pdf',
      status: 'ready',
    });
    const [row] = await groups('?q=design');
    expect(row).toMatchObject({
      id,
      name: 'Design Guild',
      memberCount: 3,
      adminCount: 1,
      owner: { id: owner.id },
      storageBytes: 4096,
      archived: false,
    });
    expect(JSON.stringify(row)).not.toContain('brief.pdf');
    expect(await groups('?filter=archived')).toEqual([]);
  });

  it('admins only', async () => {
    const who = await person();
    expect((await call(who, 'GET', '/v1/admin/groups')).statusCode).toBe(403);
    expect((await call(null, 'GET', '/v1/admin/groups')).statusCode).toBe(401);
    const id = await group(who, [], 'Mine');
    expect((await call(who, 'POST', `/v1/admin/groups/${id}/archive`, WHY)).statusCode).toBe(403);
  });
});

describe('archive and restore', () => {
  it('archived: readable and leavable, but nobody writes, joins, adds or edits', async () => {
    const [owner, b, outsider] = [await person(), await person(), await person()];
    const id = await group(owner, [b], 'Noisy');
    await say(owner, id, 'before');
    const archived = await act(id, 'archive');
    expect(archived.statusCode, archived.body).toBe(200);
    expect(archived.json().group.archived).toBe(true);

    await expect(say(b, id, 'after')).rejects.toMatchObject({ code: 'GROUP_ARCHIVED' });
    const added = await call(owner, 'POST', `/v1/chats/${id}/members`, { userIds: [outsider.id] });
    expect(added.json().code).toBe('GROUP_ARCHIVED');
    const renamed = await call(owner, 'PATCH', `/v1/chats/${id}/group`, { name: 'Quiet' });
    expect(renamed.json().code).toBe('GROUP_ARCHIVED');

    const kinds = (await history(b, id)).map((message) => message.system?.kind ?? message.text);
    expect(kinds).toContain('admin_archived');
    expect((await summary(b, id)).group?.archivedByAdmin).toBe(true);
    expect((await call(b, 'POST', `/v1/chats/${id}/leave`)).statusCode).toBe(200);
    expect((await groups('?filter=archived')).map((row) => row.id)).toContain(id);
  });

  it('restored: writing works again', async () => {
    const [owner, b] = [await person(), await person()];
    const id = await group(owner, [b], 'Paused');
    await act(id, 'archive');
    const restored = await act(id, 'restore', { reason: 'Cleared after review' });
    expect(restored.json().group.archived).toBe(false);
    await expect(say(b, id, 'back again')).resolves.toBeTruthy();
    expect((await summary(b, id)).group?.archivedByAdmin).toBeUndefined();
  });
});

describe('delete for everyone', () => {
  it('needs the name typed again and a reason', async () => {
    const owner = await person();
    const id = await group(owner, [], 'Keep Me');
    const url = `/v1/admin/groups/${id}/delete`;
    expect((await call(admin, 'POST', url, { confirmName: 'Other', ...WHY })).statusCode).toBe(400);
    expect((await call(admin, 'POST', url, { confirmName: 'Keep Me' })).statusCode).toBe(400);
  });

  it('leaves every member’s list, removes its messages and files, and is audited', async () => {
    const [owner, b] = [await person(), await person()];
    const id = await group(owner, [b], 'Bad Group');
    await say(owner, id, 'secret plan');
    const before = syncResponseSchema.parse((await call(b, 'GET', '/v1/sync')).json()).cursor;
    const response = await call(admin, 'POST', `/v1/admin/groups/${id}/delete`, {
      confirmName: 'bad group',
      ...WHY,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toEqual({ deleted: true, members: 2 });

    const sync = syncResponseSchema.parse(
      (await call(b, 'GET', `/v1/sync?since=${encodeURIComponent(before)}`)).json(),
    );
    expect(sync.cleared).toContainEqual(expect.objectContaining({ chatId: id, removeChat: true }));
    expect(await chatModels(app()).Message.countDocuments({ chatId: new Types.ObjectId(id) })).toBe(
      0,
    );
    // A former member still asks for history now and then: there is none left to see.
    const left = await call(b, 'GET', `/v1/chats/${id}/messages`);
    expect(left.statusCode === 200 ? left.json().items : []).toEqual([]);
    expect((await groups()).map((row) => row.id)).not.toContain(id);
    expect((await act(id, 'archive')).statusCode).toBe(404);
    const log = (await call(admin, 'GET', '/v1/admin/audit-log?limit=1')).json().items[0];
    expect(log).toMatchObject({
      action: 'group.delete',
      reason: 'Reported for spam',
      details: { group: 'Bad Group', members: 2 },
    });
  });
});
